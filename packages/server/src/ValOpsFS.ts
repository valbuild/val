import {
  PatchId,
  ModuleFilePath,
  ValModules,
  Internal,
  Schema,
  SelectorSource,
  SerializedSchema,
} from "@valbuild/core";
import {
  AuthorId,
  BaseSha,
  BinaryFileType,
  GenericErrorMessage,
  MetadataOfType,
  OpsMetadata,
  PreparedCommit,
  ValOps,
  ValOpsOptions,
  WithGenericError,
  bufferFromDataUrl,
  createMetadataFromBuffer,
  getFieldsForType,
  SaveSourceFilePatchResult,
  SchemaSha,
  CommitSha,
  OrderedPatches,
  OrderedPatchesMetadata,
  SourcesSha,
} from "./ValOps";
import fsPath from "path";
import ts from "typescript";
import { z } from "zod";
import fs from "fs";
import nodePath from "path";
import { fromError } from "zod-validation-error";
import { Patch, ParentRef, ValCommit } from "@valbuild/shared/internal";
import { JsonEntryFilesFingerprint } from "./jsonEntryFiles";
import { guessMimeTypeFromPath } from "./ValServer";
import { result } from "@valbuild/core/fp";
import {
  appendPatch,
  describePatchStoreProblems,
  FSPatchBaseRecord,
  FSPatchRecord,
  patchBaseFile,
  patchBinaryFile,
  patchBinaryFileMetadata,
  patchDir,
  patchesLogFile,
  PatchStoreEntry,
  readPatchStore,
  ReadPatchStoreResult,
  repairPatchStore,
  resetPatchStore,
} from "./patchStore";
import { PATCH_LOCK_FILE_NAME, withPatchLock } from "./patchLock";
import { writePatchLogFile } from "./patchLog";
import { uploadRemoteFile } from "./uploadRemoteFile";
import { Buffer } from "buffer";
import { getFileExt } from "./getFileExt";

/** Serializes a schema, or gives up quietly — serialization errors are reported elsewhere. */
function serializeSchemaSafely(
  schema: Schema<SelectorSource> | undefined,
): SerializedSchema | undefined {
  try {
    return schema?.["executeSerialize"]();
  } catch {
    return undefined;
  }
}

export class ValOpsFS extends ValOps {
  private static readonly VAL_DIR = ".val";
  private readonly host: FSOpsHost;
  constructor(
    private readonly contentUrl: string,
    private readonly rootDir: string,
    valModules: ValModules,
    options?: ValOpsOptions,
  ) {
    super(valModules, options);
    this.host = new FSOpsHost();
    this.jsonEntryFilesFingerprint = new JsonEntryFilesFingerprint(rootDir);
  }

  /**
   * Change detection for `.jsonValues()` entry files, which no sha can see (their
   * content lives behind a thunk that `JSON.stringify` drops).
   */
  private readonly jsonEntryFilesFingerprint: JsonEntryFilesFingerprint;

  override async onInit(): Promise<void> {
    // do nothing
  }

  async getPresignedAuthNonce(
    project: string,
    corsOrigin: string,
    auth: { pat: string } | { apiKey: string },
  ): Promise<
    | {
        status: "success";
        data: { nonce: string; baseUrl: string };
      }
    | { status: "error"; statusCode: 401 | 500; error: GenericErrorMessage }
  > {
    const authHeader: Record<string, string> =
      "pat" in auth
        ? { "x-val-pat": auth.pat }
        : { Authorization: `Bearer ${auth.apiKey}` };
    try {
      const res = await fetch(
        `${this.contentUrl}/v1/${project}/presigned-auth-nonce`,
        {
          method: "POST",
          headers: {
            ...authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            corsOrigin,
          }),
        },
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = z
          .object({
            nonce: z.string(),
            expiresAt: z.string(),
          })
          .safeParse(json);
        if (parsed.success) {
          return {
            status: "success",
            data: {
              nonce: parsed.data.nonce,
              baseUrl: `${this.contentUrl}/v1/${project}`,
            },
          };
        }
        console.error(
          "Could not parse presigned auth nonce response. Error: " +
            fromError(parsed.error),
        );
        return {
          status: "error",
          statusCode: 500,
          error: {
            message:
              "Could not get presigned auth nonce. The response from the content host was not in the expected format.",
          },
        };
      }
      if (res.status === 401) {
        return {
          status: "error",
          statusCode: 401,
          error: {
            message:
              "Could not get presigned auth nonce. The local PAT was rejected by the content host. Try re-running `val login`.",
          },
        };
      }
      const unknownErrorMessage = `Could not get presigned auth nonce. HTTP error: ${res.status} ${res.statusText}`;
      console.error(unknownErrorMessage);
      return {
        status: "error",
        statusCode: 500,
        error: { message: unknownErrorMessage },
      };
    } catch (e) {
      console.error(
        "Could not get presigned auth nonce (connection error?):",
        e,
      );
      return {
        status: "error",
        statusCode: 500,
        error: {
          message: `Could not get presigned auth nonce. Error: ${
            e instanceof Error ? e.message : JSON.stringify(e)
          }`,
        },
      };
    }
  }

  async getCommitSummary(): Promise<
    | { commitSummary: string | null; error?: undefined }
    | { commitSummary?: undefined; error: GenericErrorMessage }
  > {
    return {
      error: {
        message: "Val is in development / local mode. Cannot generate summary",
      },
    };
  }

  async getStat(
    params: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      sourcesSha: SourcesSha;
      patches: PatchId[];
      profileId?: AuthorId;
      jsonEntriesSha?: string;
    } | null,
  ): Promise<
    | {
        type: "request-again" | "no-change" | "did-change";
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        sourcesSha: SourcesSha;
        patches: PatchId[];
        jsonEntriesSha?: string;
      }
    | {
        type: "use-websocket";
        url: string;
        nonce: string;
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        sourcesSha: SourcesSha;
        commitSha: CommitSha;
        commits: ValCommit[];
        patches: PatchId[];
      }
    | {
        type: "error";
        error: GenericErrorMessage;
        unauthorized?: boolean;
        networkError?: boolean;
      }
  > {
    // In ValOpsFS, we don't have a websocket server to listen to file changes so we use long-polling.
    // If a file that Val depends on changes, we break the connection and tell the client to request again to get the latest values.
    try {
      const currentBaseSha = await this.getBaseSha();
      const currentSchemaSha = await this.getSchemaSha();
      const currentSourcesSha = await this.getSourcesSha();
      const schemas = await this.getSchemas();
      const moduleFilePaths = Object.keys(schemas);
      const serializedSchemas = Object.fromEntries(
        Object.entries(schemas).map(([path, schema]) => [
          path,
          serializeSchemaSafely(schema),
        ]),
      );
      const currentJsonEntriesSha =
        this.jsonEntryFilesFingerprint.compute(serializedSchemas);
      const jsonEntryFilePaths =
        this.jsonEntryFilesFingerprint.entryFilePaths(serializedSchemas);

      // The SAME read `fetchPatches` delivers from. Announcing out of one source
      // and delivering out of another is what let this store tell a studio about
      // 410 unpublished changes and then hand over 359 of them, with nothing in
      // between reporting that anything was wrong.
      const announceRes = await this.readStore();
      if (announceRes.status === "error") {
        return { type: "error", error: { message: announceRes.message } };
      }
      const patches: PatchId[] = announceRes.entries.map(
        (entry) => entry.patchId,
      );
      // something changed: return immediately
      const didChange =
        !params ||
        // An entry file changed on disk: nothing else here can see that, since a
        // jsonValues module's source is markers.
        (params.jsonEntriesSha !== undefined &&
          currentJsonEntriesSha !== params.jsonEntriesSha) ||
        currentBaseSha !== params.baseSha ||
        // base sha covers both sources sha and schema sha, so we could remove checks for schema sha and sources sha
        currentSourcesSha !== params.sourcesSha ||
        currentSchemaSha !== params.schemaSha ||
        patches.length !== params.patches.length ||
        patches.some((p, i) => p !== params.patches[i]);
      if (didChange) {
        return {
          type: "did-change",
          baseSha: currentBaseSha,
          schemaSha: currentSchemaSha,
          sourcesSha: currentSourcesSha,
          patches,
          jsonEntriesSha: currentJsonEntriesSha,
        };
      }
      let fsWatcher: fs.FSWatcher | null = null;
      let stopPolling = false;
      const didDirectoryChangeUsingPolling = (
        dir: string,
        interval: number,
        setHandle: (h: NodeJS.Timeout) => void,
      ): Promise<"request-again"> => {
        const mtimeInDir: Record<string, number> = {};
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            mtimeInDir[file] = fs
              .statSync(nodePath.join(dir, file))
              .mtime.getTime();
          }
        }
        return new Promise<"request-again">((resolve) => {
          const go = (resolve: (v: "request-again") => void) => {
            const start = Date.now();
            if (fs.existsSync(dir)) {
              const subDirs = fs.readdirSync(dir);
              // amount of files changed
              if (subDirs.length !== Object.keys(mtimeInDir).length) {
                resolve("request-again");
              }
              for (const file of fs.readdirSync(dir)) {
                const mtime = fs
                  .statSync(nodePath.join(dir, file))
                  .mtime.getTime();
                if (mtime !== mtimeInDir[file]) {
                  resolve("request-again");
                }
              }
            } else {
              // dir had files, but now is deleted
              if (Object.keys(mtimeInDir).length > 0) {
                resolve("request-again");
              }
            }
            if (Date.now() - start > interval) {
              console.warn("Val: polling interval of patches exceeded");
            }
            if (stopPolling) {
              return;
            }
            setHandle(setTimeout(() => go(resolve), interval));
          };
          setHandle(setTimeout(() => go(resolve), interval));
        });
      };

      const didFilesChangeUsingPolling = (
        files: string[],
        interval: number,
        setHandle: (h: NodeJS.Timeout) => void,
      ): Promise<"request-again"> => {
        const mtimes: Record<string, number> = {};
        for (const file of files) {
          if (fs.existsSync(file)) {
            mtimes[file] = fs.statSync(file).mtime.getTime();
          } else {
            mtimes[file] = -1;
          }
        }
        return new Promise<"request-again">((resolve) => {
          const go = (resolve: (v: "request-again") => void) => {
            const start = Date.now();
            for (const file of files) {
              const mtime = fs.existsSync(file)
                ? fs.statSync(file).mtime.getTime()
                : -1;
              if (mtime !== mtimes[file]) {
                resolve("request-again");
              }
            }
            if (Date.now() - start > interval) {
              console.warn("Val: polling interval of files exceeded");
            }
            setHandle(setTimeout(() => go(resolve), interval));
          };
          if (stopPolling) {
            return;
          }
          setHandle(setTimeout(() => go(resolve), interval));
        });
      };

      const statFilePollingInterval =
        this.options?.statFilePollingInterval || 250; // relatively low interval, but there would typically not be that many files (less than 1000 at the very least) - hopefully if we have customers with more files than that, we also have devs working on Val that easily can fix this :) Besides this is just the default
      const disableFilePolling = this.options?.disableFilePolling || false;
      let patchesDirHandle: NodeJS.Timeout;
      let valFilesIntervalHandle: NodeJS.Timeout;
      const type = await Promise.race([
        // we poll the patches directory for changes since fs.watch does not work reliably on all system (in particular on WSL) and just checking the patches dir is relatively cheap
        disableFilePolling
          ? new Promise<"request-again">(() => {})
          : didDirectoryChangeUsingPolling(
              this.getPatchesDir(),
              statFilePollingInterval,
              (handle) => {
                patchesDirHandle = handle;
              },
            ),
        // we poll the files that Val depends on for changes
        disableFilePolling
          ? new Promise<"request-again">(() => {})
          : didFilesChangeUsingPolling(
              [
                nodePath.join(this.rootDir, "val.config.ts"),
                nodePath.join(this.rootDir, "val.modules.ts"),
                nodePath.join(this.rootDir, "val.config.js"),
                nodePath.join(this.rootDir, "val.modules.js"),
                ...moduleFilePaths.map((p) => nodePath.join(this.rootDir, p)),
                // The `.jsonValues()` entry files too: their content is invisible
                // to every sha, and this polling fallback exists for the systems
                // where the `fs.watch` below does not fire (notably WSL) — without
                // them a hand-edited entry waits out the whole long-poll interval.
                ...jsonEntryFilePaths.map((p) =>
                  nodePath.join(this.rootDir, p),
                ),
              ],
              statFilePollingInterval,
              (handle) => {
                valFilesIntervalHandle = handle;
              },
            ),
        new Promise<"request-again">((resolve) => {
          fsWatcher = fs.watch(
            this.rootDir,
            {
              recursive: true,
            },
            (eventType, filename) => {
              if (!filename) {
                return;
              }
              const isChange =
                filename.startsWith(
                  this.getPatchesDir().slice(this.rootDir.length + 1),
                ) ||
                filename.endsWith(".val.ts") ||
                filename.endsWith(".val.js") ||
                // A `.jsonValues()` entry file. Its content is invisible to every
                // sha (see JsonEntryFilesFingerprint), so without this a
                // hand-edited entry never reaches an open Studio.
                filename.endsWith(".val.json") ||
                filename.endsWith("val.config.ts") ||
                filename.endsWith("val.config.js") ||
                filename.endsWith("val.modules.ts") ||
                filename.endsWith("val.modules.js");
              if (isChange) {
                // a file that Val depends on just changed or a patch was created, break connection and request stat again to get the new values
                resolve("request-again");
              }
            },
          );
        }),
        new Promise<"no-change">((resolve) =>
          setTimeout(
            () => resolve("no-change"),
            this.options?.statPollingInterval || 20000,
          ),
        ),
      ]).finally(() => {
        if (fsWatcher) {
          fsWatcher.close();
        }
        stopPolling = true;
        clearInterval(patchesDirHandle);
        clearInterval(valFilesIntervalHandle);
      });
      return {
        type,
        baseSha: currentBaseSha,
        schemaSha: currentSchemaSha,
        sourcesSha: currentSourcesSha,
        patches,
        jsonEntriesSha: currentJsonEntriesSha,
      };
    } catch (err) {
      if (err instanceof Error) {
        return { type: "error", error: { message: err.message } };
      }
      return { type: "error", error: { message: "Unknown error (getStat)" } };
    }
  }

  /**
   * The one read every other read comes out of.
   *
   * `getStat` announces from this and `fetchPatches` delivers from this, so the
   * two cannot disagree. They used to: `getStat` counted the directories on disk
   * while `fetchPatches` walked the parent links between them, and when a single
   * record went missing the first said 410 and the second said 359 — with no
   * error anywhere, because a walk that runs out of links just stops.
   *
   * Anything wrong is reported, then repaired, and reset only if repair does not
   * settle it. In that order, and never silently.
   */
  private async readStore(): Promise<
    | { status: "ok"; entries: PatchStoreEntry[] }
    | { status: "error"; message: string }
  > {
    const read = readPatchStore(this.getPatchesDir());
    if (read.status === "legacy-layout") {
      /*
       * Refused, not converted.
       *
       * Rebuilding the order would mean following the very links that are
       * unreliable here, and the stores that reach this code are the ones where
       * that has already gone wrong. Guessing at someone's unpublished work on
       * startup is not a thing to do quietly, so this stops and says so.
       */
      return {
        status: "error",
        message: `${read.message} Val cannot read patches in that layout. Move or delete ${read.patchesDir} to start over — or discard all changes in the studio, which does the same thing.`,
      };
    }
    if (read.status === "unreadable") {
      return { status: "error", message: read.message };
    }
    if (read.problems.length === 0) {
      return { status: "ok", entries: read.entries };
    }
    return this.repairStore(read);
  }

  /**
   * Report, repair, and reset only if repair did not take.
   *
   * Reached only when something is actually wrong, so the healthy path — which
   * is every stat poll — never touches the lock.
   */
  private async repairStore(
    read: Extract<ReadPatchStoreResult, { status: "ok" }>,
  ): Promise<
    | { status: "ok"; entries: PatchStoreEntry[] }
    | { status: "error"; message: string }
  > {
    const patchesDir = this.getPatchesDir();
    for (const problem of describePatchStoreProblems(read.problems)) {
      console.warn("Val: something is wrong with the patch store.", problem);
    }
    const locked = await withPatchLock(
      this.getPatchLockFile(),
      { ttlMs: 30_000, op: "repair the patch store" },
      ():
        | { status: "ok"; entries: PatchStoreEntry[] }
        | { status: "error"; message: string } => {
        // Read again under the lock. What was seen above was seen without it, so
        // a write may have landed since — and repairing against a stale picture
        // is how the old delete path destroyed live patches.
        const current = readPatchStore(patchesDir);
        if (current.status !== "ok") {
          return {
            status: "error",
            message:
              current.status === "legacy-layout"
                ? current.message
                : current.message,
          };
        }
        if (current.problems.length === 0) {
          return { status: "ok", entries: current.entries };
        }
        for (const action of repairPatchStore(patchesDir, current)) {
          if (action.type === "dropped-from-log") {
            console.warn(
              `Val: dropped the unpublished change ${action.patchId} because ${action.because}. See ${patchesDir}/patches.repair.log.`,
            );
          } else if (action.type === "removed-orphan-directory") {
            console.warn(
              `Val: removed the unused patch directory ${action.name}.`,
            );
          }
        }
        const after = readPatchStore(patchesDir);
        if (after.status === "ok" && after.problems.length === 0) {
          return { status: "ok", entries: after.entries };
        }
        // Repair did not settle it, so the store is not something anyone can
        // describe any more. Move it aside — a rename, never a delete — and say
        // where it went.
        const reset = resetPatchStore(
          patchesDir,
          "it could not be repaired automatically",
        );
        if ("error" in reset) {
          return { status: "error", message: reset.error };
        }
        console.warn(
          `Val: the patch store could not be repaired, so it was reset. The previous contents are in ${reset.movedTo}.`,
        );
        return { status: "ok", entries: [] };
      },
    );
    if (locked.status !== "ok") {
      // Someone else holds the lock, quite possibly to run this same repair.
      // Serving what was read is safe — those entries are the ones that ARE
      // readable — and the next read tries again.
      console.warn(
        `Val: could not repair the patch store now. ${locked.message}`,
      );
      return { status: "ok", entries: read.entries };
    }
    return locked.value;
  }

  override async fetchPatches<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  > {
    const storeRes = await this.readStore();
    if (storeRes.status === "error") {
      // Surfaced, not returned as an empty list. An empty answer to "what is
      // pending" is indistinguishable from "nothing is pending", and the studio
      // would render published content over unpublished edits without a word.
      const none: OrderedPatches["patches"] = [];
      return {
        patches: none,
        error: { message: storeRes.message },
        // The cast is unavoidable: the return type is conditional on a generic
        // that TypeScript cannot narrow from a value.
      } as ExcludePatchOps extends true
        ? OrderedPatchesMetadata
        : OrderedPatches;
    }
    const requested =
      filters.patchIds && filters.patchIds.length > 0
        ? new Set<PatchId>(filters.patchIds)
        : null;
    const patches = storeRes.entries
      .filter((entry) => requested === null || requested.has(entry.patchId))
      .map((entry) => ({
        patchId: entry.patchId,
        path: entry.record.path,
        patch: filters.excludePatchOps ? undefined : entry.record.patch,
        createdAt: entry.record.createdAt,
        authorId: entry.record.authorId,
        baseSha: entry.record.baseSha,
        // Publishing deletes the whole store, so in fs mode a patch that is
        // still here has not been applied. `base.json` is read for its parse
        // errors, not for this.
        appliedAt: null,
      }));
    return { patches } as ExcludePatchOps extends true
      ? OrderedPatchesMetadata
      : OrderedPatches;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseJsonFile<T = any>(
    filePath: string,
    parser?: z.ZodType<T>,
  ):
    | { data: T; error?: undefined }
    | { error: GenericErrorMessage & { filePath: string } } {
    if (!this.host.fileExists(filePath)) {
      return {
        error: {
          message: `File not found: ${filePath}`,
          filePath,
        },
      };
    }
    const data = this.host.readUtf8File(filePath);
    if (!data) {
      return {
        error: {
          message: `File is empty: ${filePath}`,
          filePath,
        },
      };
    }
    let jsonData;
    try {
      jsonData = JSON.parse(data);
    } catch (err) {
      if (
        typeof err === "object" &&
        err &&
        "message" in err &&
        typeof err.message === "string"
      ) {
        return {
          error: {
            message: `Could not parse JSON of file: ${filePath}. Message: ${err.message}`,
            filePath,
          },
        };
      }
      return {
        error: {
          message: "Unknown error",
          filePath,
        },
      };
    }
    if (!parser) {
      return { data: jsonData };
    }
    try {
      const parsed = parser.safeParse(jsonData);
      if (!parsed.success) {
        return {
          error: {
            message: `Could not parse file: ${filePath}. Details: ${JSON.stringify(
              fromError(parsed.error).toString(),
            )}`,
            details: parsed.error,
            filePath,
          },
        };
      }
      return { data: parsed.data };
    } catch (err) {
      if (
        typeof err === "object" &&
        err &&
        "message" in err &&
        typeof err.message === "string"
      ) {
        return {
          error: {
            message: `Could not parse JSON of file: ${filePath}. Message: ${err.message}`,
            filePath,
          },
        };
      }
      return {
        error: {
          message: "Unknown error",
          filePath,
        },
      };
    }
  }

  protected override async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    patchId: PatchId,
    parentRef: ParentRef,
    authorId: AuthorId | null,
    sessionId: string | null,
  ): Promise<SaveSourceFilePatchResult> {
    const patchesDir = this.getPatchesDir();
    const record: FSPatchRecord = {
      patch,
      patchId,
      path,
      authorId,
      sessionId,
      baseSha: await this.getBaseSha(),
      coreVersion: Internal.VERSION.core,
      createdAt: new Date().toISOString(),
    };
    const locked = await withPatchLock(
      this.getPatchLockFile(),
      { ttlMs: 10_000, op: "PUT /patches" },
      (): SaveSourceFilePatchResult => {
        const read = readPatchStore(patchesDir);
        if (read.status !== "ok") {
          return result.err({
            errorType: "other",
            message: read.message,
          });
        }
        /*
         * `parentRef` is a compare-and-swap token, not a place to write.
         *
         * It used to be neither. It named the directory the record went into and
         * nothing ever checked it, so a client working from a stale view could
         * write a patch whose parent had never landed — and every patch chained
         * behind that one was then unreachable, with the studio waiting on ids
         * the server would never send. Refusing here is what makes that state
         * unreachable rather than merely unlikely.
         *
         * The client already knows how to handle the conflict: it resyncs and
         * retries. The tail goes back with the refusal so it can rebase at once
         * instead of waiting for the next stat.
         */
        const tail = read.entries[read.entries.length - 1]?.patchId;
        const claimed =
          parentRef.type === "head" ? undefined : parentRef.patchId;
        if (claimed !== tail) {
          return result.err({ errorType: "patch-head-conflict", tail });
        }
        try {
          appendPatch(patchesDir, record);
        } catch (err) {
          return result.err({
            errorType: "other",
            message: `Failed to write the patch: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          });
        }
        return result.ok({ patchId });
      },
    );
    if (locked.status !== "ok") {
      return result.err({ errorType: "other", message: locked.message });
    }
    return locked.value;
  }

  protected override async getSourceFile(
    path: string,
  ): Promise<WithGenericError<{ data: string }>> {
    const filePath = fsPath.join(this.rootDir, path);
    if (!this.host.fileExists(filePath)) {
      return {
        error: { message: `File not found: ${filePath}` },
      };
    }
    return {
      data: this.host.readUtf8File(filePath),
    };
  }

  protected async saveSourceFile(
    path: ModuleFilePath,
    data: string,
  ): Promise<WithGenericError<{ path: ModuleFilePath }>> {
    const filePath = fsPath.join(this.rootDir, ...path.split("/"));
    try {
      this.host.writeUf8File(filePath, data);
      return { path };
    } catch (err) {
      if (err instanceof Error) {
        return { error: { message: err.message } };
      }
      return { error: { message: "Unknown error" } };
    }
  }

  override async saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    _parentRef: ParentRef,
    patchId: PatchId,
    data: string | null,
    _type: BinaryFileType,
    metadata: MetadataOfType<BinaryFileType> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    // Keyed by the patch's own id, so the parent is not needed and is not asked
    // for. Uploads arrive before the patch record does, which is fine: the
    // directory sits there unreferenced until the log line that names it lands,
    // and repair sweeps it up if that never happens.
    const patchesDir = this.getPatchesDir();
    const patchFilePath = patchBinaryFile(patchesDir, patchId, filePath);
    const metadataFilePath = patchBinaryFileMetadata(
      patchesDir,
      patchId,
      filePath,
    );
    try {
      if (data === null) {
        this.host.deleteFile(patchFilePath);
        this.host.deleteFile(metadataFilePath);
        return { patchId, filePath };
      }
      const buffer = bufferFromDataUrl(data);
      if (!buffer) {
        return {
          error: {
            message:
              "Could not create buffer from data url. Not a data url? First chars were: " +
              data.slice(0, 20),
          },
        };
      }
      this.host.writeUf8File(metadataFilePath, JSON.stringify(metadata));
      this.host.writeBinaryFile(patchFilePath, buffer);
      return { patchId, filePath };
    } catch (err) {
      if (err instanceof Error) {
        return { error: { message: err.message } };
      }
      return { error: { message: "Unknown error" } };
    }
  }

  protected override async getBase64EncodedBinaryFileMetadataFromPatch<
    T extends BinaryFileType,
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>> {
    const metadataFilePath = patchBinaryFileMetadata(
      this.getPatchesDir(),
      patchId,
      filePath,
    );

    if (!this.host.fileExists(metadataFilePath)) {
      return {
        errors: [{ message: "Metadata file not found", filePath }],
      };
    }
    const metadataParseRes = this.parseJsonFile(
      metadataFilePath,
      z.record(z.string(), z.union([z.string(), z.number()])),
    );
    if (metadataParseRes.error) {
      return { errors: [metadataParseRes.error] };
    }
    const parsed = metadataParseRes.data;
    const expectedFields = getFieldsForType(type);
    const fieldErrors = [];
    for (const field of expectedFields) {
      if (!(field in parsed)) {
        fieldErrors.push({
          message: `Expected fields for type: ${type}. Field not found: '${field}'`,
          field,
        });
      }
    }
    if (fieldErrors.length > 0) {
      return { errors: fieldErrors };
    }
    return { metadata: parsed } as OpsMetadata<T>;
  }

  override async getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
  ): Promise<Buffer | null> {
    // Straight from the id. This used to read and parse every patch on disk to
    // work out which directory the file was under, on every single image request.
    const absPath = patchBinaryFile(this.getPatchesDir(), patchId, filePath);
    if (!this.host.fileExists(absPath)) {
      return null;
    }
    return this.host.readBinaryFile(absPath);
  }

  override async deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined; error?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  > {
    const patchesDir = this.getPatchesDir();
    const requested = new Set<PatchId>(patchIds);
    const locked = await withPatchLock(
      this.getPatchLockFile(),
      { ttlMs: 30_000, op: "DELETE /patches" },
      ():
        | {
            status: "ok";
            deleted: PatchId[];
            errors: Record<PatchId, GenericErrorMessage>;
          }
        | { status: "error"; message: string } => {
        const read = readPatchStore(patchesDir);
        if (read.status !== "ok") {
          return { status: "error", message: read.message };
        }
        /*
         * Deleting is now dropping lines from a list.
         *
         * It used to be a three-step re-link per surviving patch — rewrite a
         * record, remove the destination directory, rename another one over it —
         * with the plan computed from a snapshot taken before hundreds of file
         * reads, every failure swallowed by a `console.error`, and one step that
         * unconditionally removed whatever occupied the destination. An
         * interruption anywhere in it stranded every patch after the hole.
         */
        writePatchLogFile(
          patchesLogFile(patchesDir),
          read.entries
            .filter((entry) => !requested.has(entry.patchId))
            .map((entry) => ({
              patchId: entry.patchId,
              createdAt: entry.record.createdAt,
              path: entry.record.path,
            })),
        );
        // The log first, then the directories. A crash in between leaves
        // directories nothing names, which is inert and swept up on the next
        // read; the other order would leave the log naming patches that are gone.
        const deleted: PatchId[] = [];
        const errors: Record<PatchId, GenericErrorMessage> = {};
        for (const patchId of patchIds) {
          try {
            fs.rmSync(patchDir(patchesDir, patchId), {
              recursive: true,
              force: true,
            });
            deleted.push(patchId);
          } catch (err) {
            // Reported. This endpoint used to answer "deleted" unconditionally —
            // `deleted` and `errors` were never written to at all — so a delete
            // that failed looked exactly like one that worked.
            errors[patchId] = {
              message: `Could not remove the files for ${patchId}: ${
                err instanceof Error ? err.message : "unknown error"
              }`,
            };
          }
        }
        return { status: "ok", deleted, errors };
      },
    );
    if (locked.status !== "ok") {
      return { error: { message: locked.message } };
    }
    if (locked.value.status === "error") {
      return { error: { message: locked.value.message } };
    }
    const { deleted, errors } = locked.value;
    if (Object.keys(errors).length > 0) {
      return { deleted, errors };
    }
    return { deleted };
  }

  async deleteAllPatches(): Promise<{ error?: GenericErrorMessage }> {
    const patchesDir = this.getPatchesDir();
    const locked = await withPatchLock(
      this.getPatchLockFile(),
      { ttlMs: 30_000, op: "delete all patches" },
      (): { error?: GenericErrorMessage } => {
        if (!fs.existsSync(patchesDir)) {
          return {};
        }
        const tmpDir = fsPath.join(
          this.rootDir,
          ValOpsFS.VAL_DIR,
          "patches-deleted-" + crypto.randomUUID(),
        );
        try {
          // One rename takes the log and the directories together, so the store
          // is empty and self-consistent from the first instant rather than
          // part-way through. It is also the cleanup route for a store this
          // version refuses to read: discarding everything always works.
          this.host.moveDir(patchesDir, tmpDir);
          this.host.deleteDir(tmpDir);
          return {};
        } catch (err) {
          return {
            error: {
              message: `Got an error while deleting patches: ${
                err instanceof Error ? err.message : "unknown error"
              }`,
            },
          };
        }
      },
    );
    if (locked.status !== "ok") {
      return { error: { message: locked.message } };
    }
    return locked.value;
  }

  async saveOrUploadFiles(
    preparedCommit: PreparedCommit,
    mode: "skip-remote" | "upload-remote",
    auth?:
      | {
          apiKey: string;
        }
      | { pat: string },
  ): Promise<{
    updatedFiles: string[];
    uploadedRemoteRefs: string[];
    errors: Record<string, GenericErrorMessage & { filePath?: string }>;
  }> {
    const updatedFiles: string[] = [];
    const uploadedRemoteRefs: string[] = [];
    const errors: Record<string, GenericErrorMessage & { filePath?: string }> =
      {};

    const remoteFileDescriptors = Object.entries(
      preparedCommit.patchedBinaryFilesDescriptors,
    )
      .filter(([, { remote }]) => remote)
      .map(([ref, { patchId }]) => [ref, { patchId }] as const);
    const localFileDescriptors = Object.entries(
      preparedCommit.patchedBinaryFilesDescriptors,
    )
      .filter(([, { remote }]) => !remote)
      .map(([ref, { patchId }]) => [ref, { patchId }] as const);

    if (mode === "upload-remote") {
      if (!auth) {
        errors["auth"] = {
          message: "No auth provided",
        };
        return {
          updatedFiles,
          uploadedRemoteRefs,
          errors,
        };
      }
      for (const [ref, { patchId }] of remoteFileDescriptors) {
        const splitRemoteRefRes = Internal.remote.splitRemoteRef(ref);
        if (splitRemoteRefRes.status === "error") {
          errors[ref] = {
            message: "Failed to split remote ref: " + ref,
          };
          continue;
        }
        const fileBuffer = await this.getBase64EncodedBinaryFileFromPatch(
          splitRemoteRefRes.filePath,
          patchId,
        );
        if (!fileBuffer) {
          errors[ref] = {
            message:
              "Failed to get binary file from patch. Ref: " +
              ref +
              ". PatchId: " +
              patchId,
          };
          continue;
        }
        if (!this.options?.config.project) {
          errors[ref] = {
            message: "No project found in config",
          };
          continue;
        }
        const res = await uploadRemoteFile(
          this.contentUrl,
          this.options.config.project,
          splitRemoteRefRes.bucket,
          splitRemoteRefRes.fileHash,
          getFileExt(splitRemoteRefRes.filePath),
          fileBuffer,
          auth,
        );
        if (!res.success) {
          console.error("Failed to upload remote file", ref, res.error);
          throw new Error(`Failed to upload remote file: ${ref}. ${res.error}`);
        }
        uploadedRemoteRefs.push(ref);
      }
    }

    for (const [ref, { patchId }] of localFileDescriptors) {
      const filePath = ref;
      const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
      try {
        this.host.copyFile(
          patchBinaryFile(this.getPatchesDir(), patchId, filePath),
          absPath,
        );
        updatedFiles.push(absPath);
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath: filePath,
        };
      }
    }

    for (const [filePath, data] of Object.entries(
      preparedCommit.patchedSourceFiles,
    )) {
      const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
      try {
        if (data === null) {
          this.host.deleteFile(absPath);
        } else {
          this.host.writeUf8File(absPath, data);
        }
        updatedFiles.push(absPath);
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath,
        };
      }
    }

    for (const patchId of Object.values(preparedCommit.appliedPatches).flat()) {
      const appliedAt: FSPatchBaseRecord = {
        baseSha: await this.getBaseSha(),
        timestamp: new Date().toISOString(),
      };
      const absPath = patchBaseFile(this.getPatchesDir(), patchId);
      try {
        this.host.writeUf8File(absPath, JSON.stringify(appliedAt));
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath: absPath,
        };
      }
    }
    return {
      updatedFiles,
      uploadedRemoteRefs,
      errors,
    };
  }

  override async getBinaryFile(filePath: string): Promise<Buffer | null> {
    const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
    if (!this.host.fileExists(absPath)) {
      return null;
    }
    const buffer = this.host.readBinaryFile(absPath);
    return buffer;
  }

  protected override async getBinaryFileMetadata<T extends BinaryFileType>(
    filePath: string,
    type: T,
  ): Promise<OpsMetadata<T>> {
    const buffer = await this.getBinaryFile(filePath);
    if (!buffer) {
      return {
        errors: [{ message: "File not found", filePath }],
      };
    }
    const mimeType = guessMimeTypeFromPath(filePath);
    if (!mimeType) {
      return {
        errors: [
          {
            message: `Could not guess mime type of file ext: ${fsPath.extname(
              filePath,
            )}`,
            filePath,
          },
        ],
      };
    }
    return createMetadataFromBuffer(type, mimeType, buffer);
  }

  // #region fs file path helpers
  private getPatchesDir() {
    return fsPath.join(this.rootDir, ValOpsFS.VAL_DIR, "patches");
  }

  /**
   * Deliberately outside the patches directory: delete-all and reset rename that
   * whole directory, and a lock that moves away with it is not holding anything.
   */
  private getPatchLockFile() {
    return fsPath.join(this.rootDir, ValOpsFS.VAL_DIR, PATCH_LOCK_FILE_NAME);
  }
}

class FSOpsHost {
  constructor() {}

  // TODO: do we want async operations here?
  deleteDir(dir: string) {
    if (this.directoryExists(dir)) {
      fs.rmSync(dir, {
        recursive: true,
      });
    }
  }

  deleteFile(path: string) {
    if (this.fileExists(path)) {
      fs.rmSync(path);
    }
  }

  moveDir(from: string, to: string) {
    fs.renameSync(from, to);
  }

  directoryExists(path: string): boolean {
    return ts.sys.directoryExists(path);
  }

  readDirectory(
    path: string,
    extensions: readonly string[] | undefined,
    exclude: readonly string[] | undefined,
    include: readonly string[],
  ): readonly string[] {
    return ts.sys.readDirectory(path, extensions, exclude, include);
  }

  fileExists(path: string): boolean {
    return ts.sys.fileExists(path);
  }

  readBinaryFile(path: string): Buffer {
    return fs.readFileSync(path);
  }

  readUtf8File(path: string): string {
    return fs.readFileSync(path, "utf-8");
  }

  writeUf8File(path: string, data: string): void {
    fs.mkdirSync(fsPath.dirname(path), { recursive: true });
    fs.writeFileSync(path, data, "utf-8");
  }

  tryWriteUf8File(
    path: string,
    data: string,
  ):
    | { type: "success" }
    | {
        type: "error";
        errorType: "failed-to-write-file";
        error: unknown;
      } {
    try {
      const parentDir = fsPath.join(fsPath.dirname(path), "../");
      fs.mkdirSync(parentDir, { recursive: true });
      // Make the parent dir separately. This is because we need mkdir to throw
      // if the directory already exists. If we use recursive: true, it doesn't
      fs.mkdirSync(fsPath.dirname(path), { recursive: false });
    } catch {
      // ignore
    }
    try {
      fs.writeFileSync(path, data, "utf-8");
    } catch (e) {
      return {
        type: "error",
        errorType: "failed-to-write-file",
        error: e,
      };
    }
    return { type: "success" };
  }

  writeBinaryFile(path: string, data: Buffer): void {
    fs.mkdirSync(fsPath.dirname(path), { recursive: true });
    fs.writeFileSync(path, new Uint8Array(data), "base64url");
  }

  copyFile(from: string, to: string): void {
    fs.mkdirSync(fsPath.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
