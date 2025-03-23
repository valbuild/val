import { PatchId, ModuleFilePath, ValModules, Internal } from "@valbuild/core";
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
  PatchReadError,
} from "./ValOps";
import fsPath from "path";
import ts from "typescript";
import { z } from "zod";
import fs from "fs";
import nodePath from "path";
import { fromError } from "zod-validation-error";
import { Patch, ParentRef } from "@valbuild/shared/internal";
import { guessMimeTypeFromPath } from "./ValServer";
import { result } from "@valbuild/core/fp";
import { ParentPatchId } from "@valbuild/core";
import { computeChangedPatchParentRefs } from "./computeChangedPatchParentRefs";
import { uploadRemoteRef } from "./uploadRemoteFile";

export class ValOpsFS extends ValOps {
  private static readonly VAL_DIR = ".val";
  private readonly host: FSOpsHost;
  constructor(
    private readonly rootDir: string,
    valModules: ValModules,
    options?: ValOpsOptions,
  ) {
    super(valModules, options);
    this.host = new FSOpsHost();
  }

  override async onInit(): Promise<void> {
    // do nothing
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
      patches: PatchId[];
      profileId?: AuthorId;
    } | null,
  ): Promise<
    | {
        type: "request-again" | "no-change" | "did-change";
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        patches: PatchId[];
      }
    | {
        type: "use-websocket";
        url: string;
        nonce: string;
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        commitSha: CommitSha;
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
      const moduleFilePaths = Object.keys(await this.getSchemas());

      const patchData = await this.readPatches();
      const patches: PatchId[] = [];
      // TODO: use proper patch sequences when available:
      for (const [patchId] of Object.entries(patchData.patches).sort(
        ([, a], [, b]) => {
          return a.createdAt.localeCompare(b.createdAt, undefined);
        },
      )) {
        patches.push(patchId as PatchId);
      }
      // something changed: return immediately
      const didChange =
        !params ||
        currentBaseSha !== params.baseSha ||
        currentSchemaSha !== params.schemaSha ||
        patches.length !== params.patches.length ||
        patches.some((p, i) => p !== params.patches[i]);
      if (didChange) {
        return {
          type: "did-change",
          baseSha: currentBaseSha,
          schemaSha: currentSchemaSha,
          patches,
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
        patches,
      };
    } catch (err) {
      if (err instanceof Error) {
        return { type: "error", error: { message: err.message } };
      }
      return { type: "error", error: { message: "Unknown error (getStat)" } };
    }
  }

  private async readPatches(includes?: PatchId[]): Promise<FSPatches> {
    const patchesCacheDir = this.getPatchesDir();
    let patchJsonFiles: readonly string[] = [];
    if (
      !this.host.directoryExists ||
      (this.host.directoryExists && this.host.directoryExists(patchesCacheDir))
    ) {
      patchJsonFiles = this.host.readDirectory(
        patchesCacheDir,
        ["patch.json"],
        [],
        [],
      );
    }
    const patches: FSPatches["patches"] = {};
    const errors: NonNullable<FSPatches["errors"]> = [];

    const parsedUnsortedFsPatches = patchJsonFiles
      .map((file) => fsPath.basename(fsPath.dirname(file)) as ParentPatchId)
      .map(
        (patchDir) =>
          [
            patchDir,
            this.parseJsonFile(this.getPatchFilePath(patchDir), FSPatch),
            this.host.fileExists(this.getPatchBaseFile(patchDir))
              ? this.parseJsonFile(this.getPatchBaseFile(patchDir), FSPatchBase)
              : undefined,
          ] as const,
      );

    parsedUnsortedFsPatches.forEach(([dir, parsedPatch, parsedBase]) => {
      if (parsedPatch.error) {
        errors.push({ ...parsedPatch.error, parentPatchId: dir });
      } else if (parsedBase && parsedBase.error) {
        errors.push({ ...parsedBase.error, parentPatchId: dir });
      } else {
        if (
          includes &&
          includes.length > 0 &&
          !includes.includes(parsedPatch.data.patchId as PatchId)
        ) {
          return;
        }

        patches[parsedPatch.data.patchId as PatchId] = {
          ...(parsedPatch.data as {
            // parseFile does keep refined types?
            path: ModuleFilePath;
            patch: Patch;
            patchId: PatchId;
            parentRef: ParentRef;
            baseSha: BaseSha;
            createdAt: string;
            authorId: AuthorId | null;
            coreVersion: string;
          }),
          appliedAt: null,
        };
      }
    });

    // If there are patches, but no head. error
    if (Object.keys(errors).length > 0) {
      return { patches, errors };
    }
    return { patches };
  }

  getParentPatchIdFromParentRef(parentRef: ParentRef): ParentPatchId {
    return (
      parentRef.type === "head" ? "head" : parentRef.patchId
    ) as ParentPatchId;
  }

  override async fetchPatches<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  > {
    const fetchPatchesRes = await this.fetchPatchesFromFS(
      !!filters.excludePatchOps,
    );
    const sortedPatches = (
      this.createPatchChain(
        fetchPatchesRes.patches,
      ) as OrderedPatches["patches"]
    ).map((patchData) => {
      if (filters.excludePatchOps) {
        return {
          ...patchData,
          patch: undefined,
        };
      }
      return patchData;
    });

    return {
      patches: sortedPatches,
      errors: fetchPatchesRes.errors,
    } as ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches;
  }

  async fetchPatchesFromFS<ExcludePatchOps extends boolean>(
    excludePatchOps: ExcludePatchOps,
  ): Promise<ExcludePatchOps extends true ? FSPatchesMetadata : FSPatches> {
    const patches: (ExcludePatchOps extends true
      ? FSPatchesMetadata
      : FSPatches)["patches"] = {};
    const { errors, patches: allPatches } = await this.readPatches();
    for (const [patchIdS, patch] of Object.entries(allPatches)) {
      const patchId = patchIdS as PatchId;
      patches[patchId] = {
        patch: excludePatchOps ? undefined : patch.patch,
        parentRef: patch.parentRef,
        path: patch.path,
        baseSha: patch.baseSha,
        createdAt: patch.createdAt,
        authorId: patch.authorId,
        appliedAt: patch.appliedAt,
      };
    }
    if (errors && errors.length > 0) {
      return { patches, errors } as ExcludePatchOps extends true
        ? FSPatchesMetadata
        : FSPatches;
    }
    return { patches } as ExcludePatchOps extends true
      ? FSPatchesMetadata
      : FSPatches;
  }

  // #region createPatchChain
  private createPatchChain<
    T extends FSPatches["patches"] | FSPatchesMetadata["patches"],
  >(
    unsortedPatchRecord: T,
  ): T extends FSPatches["patches"]
    ? OrderedPatches["patches"]
    : OrderedPatchesMetadata["patches"] {
    // TODO: Error handling
    const nextPatch: Record<PatchId, PatchId | undefined> = {};
    Object.keys(unsortedPatchRecord).forEach((patchId) => {
      const patch = unsortedPatchRecord[patchId as PatchId];
      if (patch.parentRef.type === "head") {
        nextPatch["head" as PatchId] = patchId as PatchId;
      } else {
        nextPatch[patch.parentRef.patchId as PatchId] = patchId as PatchId;
      }
    });

    const sortedPatches = [];

    let nextPatchId: PatchId | undefined = Object.entries(
      unsortedPatchRecord,
    ).find(([, patch]) => patch.parentRef.type === "head")?.[0] as PatchId;

    while (!!nextPatchId && nextPatchId in unsortedPatchRecord) {
      const patch = unsortedPatchRecord[nextPatchId] as Partial<
        (typeof unsortedPatchRecord)[PatchId]
      >;
      delete patch["parentRef"];
      sortedPatches.push({
        ...patch,
        patchId: nextPatchId,
      });
      nextPatchId = nextPatch[nextPatchId];
    }

    return sortedPatches as unknown as T extends FSPatches["patches"]
      ? OrderedPatches["patches"]
      : OrderedPatchesMetadata["patches"];
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
    parentRef: ParentRef,
    authorId: AuthorId | null,
  ): Promise<SaveSourceFilePatchResult> {
    const patchDir = this.getParentPatchIdFromParentRef(parentRef);
    try {
      const baseSha = await this.getBaseSha();
      const patchId = crypto.randomUUID() as PatchId;
      const data: z.infer<typeof FSPatch> = {
        patch,
        patchId,
        parentRef,
        path,
        authorId,
        baseSha,
        coreVersion: Internal.VERSION.core,
        createdAt: new Date().toISOString(),
      };
      const writeRes = this.host.tryWriteUf8File(
        this.getPatchFilePath(patchDir),
        JSON.stringify(data),
      );

      if (writeRes.type === "error") {
        return writeRes.errorType === "dir-already-exists"
          ? result.err({ errorType: "patch-head-conflict" })
          : result.err({
              errorType: "other",
              error: writeRes.error,
              message: "Failed to write patch file",
            });
      }
      return result.ok({ patchId });
    } catch (err) {
      if (err instanceof Error) {
        return result.err({
          errorType: "other",
          error: err,
          message: err.message,
        });
      }
      return result.err({
        errorType: "other",
        error: err,
        message: "Unknown error",
      });
    }
  }

  protected override async getSourceFile(
    path: ModuleFilePath,
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

  protected override async saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    parentRef: ParentRef,
    patchId: PatchId,
    data: string,
    _type: BinaryFileType,
    metadata: MetadataOfType<BinaryFileType>,
    remote: boolean,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    const patchDir = this.getParentPatchIdFromParentRef(parentRef);
    const patchFilePath = this.getBinaryFilePath(filePath, patchDir, remote);
    const metadataFilePath = this.getBinaryFileMetadataPath(
      filePath,
      patchDir,
      remote,
    );
    try {
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
  >(
    filePath: string,
    type: T,
    patchId: PatchId,
    remote: boolean,
  ): Promise<OpsMetadata<T>> {
    const patchDirRes = await this.getParentPatchIdFromPatchId(patchId);
    if (result.isErr(patchDirRes)) {
      return {
        errors: [{ message: "Failed to get patch dir from patch id" }],
      };
    }
    const metadataFilePath = this.getBinaryFileMetadataPath(
      filePath,
      patchDirRes.value,
      remote,
    );

    if (!this.host.fileExists(metadataFilePath)) {
      return {
        errors: [{ message: "Metadata file not found", filePath }],
      };
    }
    const metadataParseRes = this.parseJsonFile(
      metadataFilePath,
      z.record(z.union([z.string(), z.number()])),
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
    const patchDirRes = await this.getParentPatchIdFromPatchId(patchId);
    if (!result.isOk(patchDirRes)) {
      return null;
    }
    const absPath = this.getBinaryFilePath(
      filePath,
      patchDirRes.value,
      // remote and local are the same in this case
      false,
    );

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
    const deleted: PatchId[] = [];
    const errors: Record<PatchId, GenericErrorMessage> | null = null;
    const patchDirMapRes = await this.getParentPatchIdFromPatchIdMap();
    if (result.isErr(patchDirMapRes)) {
      return { error: { message: "Failed to get patch dir map" } };
    }
    const currentPatches = this.createPatchChain(
      (await this.fetchPatchesFromFS(false)).patches,
    );
    this.updateOrderedPatches(
      computeChangedPatchParentRefs(currentPatches, patchIds),
      patchDirMapRes.value,
      patchIds,
    );
    if (errors) {
      return { deleted, errors };
    }
    return { deleted };
  }

  private updateOrderedPatches(
    updates: {
      changedPatches: Record<PatchId, ParentRef>;
    },
    patchDirMap: Record<PatchId, ParentPatchId | undefined>,
    deletePatchIds: PatchId[],
  ) {
    for (const patchId of deletePatchIds) {
      const patchDir = patchDirMap[patchId];
      if (!patchDir) {
        console.error(
          "Could not find patch dir for patch id scheduled for deletion: ",
          patchId,
        );
        continue;
      }
      try {
        this.host.deleteDir(this.getFullPatchDir(patchDir));
      } catch (err) {
        console.error("Failed to delete patch dir", err);
      }
    }
    for (const [patchIdS, parentRef] of Object.entries(
      updates.changedPatches,
    )) {
      const prevParentPatchId = patchDirMap[patchIdS as PatchId];
      if (!prevParentPatchId) {
        console.error(
          "Could not find previous parent patch id for deleted patch id: ",
          patchIdS,
        );
        continue;
      }
      const newParentPatchId = (
        parentRef.type === "head" ? "head" : parentRef.patchId
      ) as ParentPatchId;
      const currentPatchDataRes = this.parseJsonFile(
        this.getPatchFilePath(prevParentPatchId),
        FSPatch,
      );
      if (currentPatchDataRes.error) {
        console.error(
          "Failed to parse patch file while fixing patch chain after deleted patch",
          { updates },
          currentPatchDataRes.error,
        );
        continue;
      }
      const newPatchData = currentPatchDataRes.data;
      newPatchData.parentRef = parentRef;

      try {
        this.host.writeUf8File(
          this.getPatchFilePath(prevParentPatchId),
          JSON.stringify(newPatchData),
        );
        if (this.host.directoryExists(this.getFullPatchDir(newParentPatchId))) {
          this.host.deleteDir(this.getFullPatchDir(newParentPatchId));
        }
        this.host.moveDir(
          this.getFullPatchDir(prevParentPatchId),
          this.getFullPatchDir(newParentPatchId),
        );
      } catch (err) {
        console.error(
          "Failed fix patch chain after deleted patch",
          { updates },
          err,
        );
      }
    }
  }

  async saveOrUploadFiles(
    preparedCommit: PreparedCommit,
    auth:
      | {
          apiKey: string;
        }
      | { pat: string },
    testMode?: "test-skip-remote",
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
      if (testMode === "test-skip-remote") {
        console.log("Skip remote flag enabled. Skipping file upload", ref);
        continue;
      }
      console.log("Uploading remote file", ref);
      const res = await uploadRemoteRef(fileBuffer, ref, auth);
      if (!res.success) {
        console.error("Failed to upload remote file", ref, res.error);
        throw new Error(`Failed to upload remote file: ${ref}. ${res.error}`);
      }
      console.log("Completed remote file", ref);
      uploadedRemoteRefs.push(ref);
    }

    const patchIdToPatchDirMapRes = await this.getParentPatchIdFromPatchIdMap();
    if (result.isErr(patchIdToPatchDirMapRes)) {
      return {
        updatedFiles,
        uploadedRemoteRefs,
        errors,
      };
    }
    const patchIdToPatchDirMap = patchIdToPatchDirMapRes.value;

    for (const [ref, { patchId }] of localFileDescriptors) {
      const filePath = ref;
      const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
      try {
        const patchDir = patchIdToPatchDirMap[patchId];
        if (!patchDir) {
          errors[absPath] = {
            message: "Failed to find PatchDir for PatchId " + patchId,
            filePath: filePath,
          };
          continue;
        }
        this.host.copyFile(
          this.getBinaryFilePath(filePath, patchDir, false),
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
        this.host.writeUf8File(absPath, data);
        updatedFiles.push(absPath);
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath,
        };
      }
    }

    for (const patchId of Object.values(preparedCommit.appliedPatches).flat()) {
      const appliedAt: z.infer<typeof FSPatchBase> = {
        baseSha: await this.getBaseSha(),
        timestamp: new Date().toISOString(),
      };
      const patchDir = patchIdToPatchDirMap[patchId];
      if (!patchDir) {
        errors[`patchId:${patchId}`] = {
          message: "Failed to find PatchDir for PatchId " + patchId,
        };
        continue;
      }
      const absPath = this.getPatchBaseFile(patchDir);
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

  private async getParentPatchIdFromPatchId(
    patchId: PatchId,
  ): Promise<
    result.Result<ParentPatchId, "failed-to-read-patches" | "patch-not-found">
  > {
    // This is not great. If needed we should find a better way
    const patches = await this.readPatches();
    if (patches.errors || patches.error) {
      console.error("Failed to read patches", JSON.stringify(patches));
      return result.err("failed-to-read-patches");
    }
    const patch = patches.patches[patchId];
    if (!patch) {
      console.error("Could not find patch with patchId: ", patchId);
      return result.err("patch-not-found");
    }

    return result.ok(this.getParentPatchIdFromParentRef(patch.parentRef));
  }

  private async getParentPatchIdFromPatchIdMap(): Promise<
    result.Result<
      Record<PatchId, ParentPatchId | undefined>,
      "failed-to-read-patches"
    >
  > {
    const patches = await this.readPatches();
    if (patches.errors || patches.error) {
      console.error("Failed to read patches", JSON.stringify(patches));
      return result.err("failed-to-read-patches");
    }
    return result.ok(
      Object.fromEntries(
        Object.entries(patches.patches).map(([patchId, value]) => [
          patchId,
          this.getParentPatchIdFromParentRef(value.parentRef),
        ]),
      ),
    );
  }

  // #region profiles
  override async getProfiles(): Promise<
    { profileId: string; fullName: string; avatar: { url: string } | null }[]
  > {
    // We do not have profiles in FS mode
    return [];
  }

  // #region fs file path helpers
  private getPatchesDir() {
    return fsPath.join(this.rootDir, ValOpsFS.VAL_DIR, "patches");
  }

  private getFullPatchDir(patchDir: ParentPatchId) {
    return fsPath.join(this.getPatchesDir(), patchDir);
  }

  private getBinaryFilePath(
    filePath: string,
    patchDir: ParentPatchId,
    remote: boolean,
  ) {
    if (remote) {
      const res = Internal.remote.splitRemoteRef(filePath);
      if (res.status === "error") {
        throw new Error("Failed to split remote ref");
      }
      const actualFilePath = res.filePath;
      return fsPath.join(
        this.getFullPatchDir(patchDir),
        "files",
        actualFilePath,
        fsPath.basename(actualFilePath),
      );
    }
    return fsPath.join(
      this.getFullPatchDir(patchDir),
      "files",
      filePath,
      fsPath.basename(filePath),
    );
  }

  private getBinaryFileMetadataPath(
    filePath: string,
    patchDir: ParentPatchId,
    remote: boolean,
  ) {
    if (remote) {
      const res = Internal.remote.splitRemoteRef(filePath);
      if (res.status === "error") {
        throw new Error("Failed to split remote ref (in metadata path)");
      }
      const actualFilePath = res.filePath;
      return fsPath.join(
        this.getFullPatchDir(patchDir),
        "files",
        actualFilePath,
        fsPath.basename(actualFilePath),
      );
    }
    return fsPath.join(
      this.getFullPatchDir(patchDir),
      "files",
      filePath,
      "metadata.json",
    );
  }

  private getPatchFilePath(patchDir: ParentPatchId) {
    return fsPath.join(this.getFullPatchDir(patchDir), "patch.json");
  }

  private getPatchBaseFile(patchDir: ParentPatchId) {
    return fsPath.join(this.getFullPatchDir(patchDir), "base.json");
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

  moveDir(from: string, to: string) {
    fs.renameSync(from, to);
  }

  directoryExists(path: string): boolean {
    return ts.sys.directoryExists(path);
  }

  readDirectory(
    path: string,
    extensions: readonly string[],
    exclude: readonly string[],
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
        errorType: "dir-already-exists" | "failed-to-write-file";
        error: unknown;
      } {
    try {
      const parentDir = fsPath.join(fsPath.dirname(path), "../");
      fs.mkdirSync(parentDir, { recursive: true });
      // Make the parent dir separately. This is because we need mkdir to throw
      // if the directory already exists. If we use recursive: true, it doesn't
      fs.mkdirSync(fsPath.dirname(path), { recursive: false });
    } catch (e) {
      return {
        type: "error",
        errorType: "dir-already-exists",
        error: e,
      };
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
    fs.writeFileSync(path, data, "base64url");
  }

  copyFile(from: string, to: string): void {
    fs.mkdirSync(fsPath.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

const FSPatch = z.object({
  path: z
    .string()
    .refine(
      (p): p is ModuleFilePath => p.startsWith("/") && p.includes(".val."),
      "Path is not valid. Must start with '/' and include '.val.'",
    ),
  patch: Patch,
  patchId: z.string(),
  baseSha: z.string(),
  parentRef: ParentRef,
  authorId: z
    .string()
    .refine((p): p is AuthorId => true)
    .nullable(),
  createdAt: z.string().datetime(),
  coreVersion: z.string().nullable(), // TODO: use this to check if patch is compatible with current core version?
});

const FSPatchBase = z.object({
  baseSha: z.string().refine((p): p is BaseSha => true),
  timestamp: z.string().datetime(),
});

type FSPatches = {
  patches: Record<
    PatchId,
    {
      path: ModuleFilePath;
      patch: Patch;
      parentRef: ParentRef;
      createdAt: string;
      authorId: AuthorId | null;
      baseSha: BaseSha;
      appliedAt: null;
    }
  >;
  error?: GenericErrorMessage;
  errors?: PatchReadError[];
};

type FSPatchesMetadata = {
  patches: Record<
    PatchId,
    Omit<FSPatches["patches"][PatchId], "patch"> & { patch?: undefined }
  >;
  error?: GenericErrorMessage;
  errors?: FSPatches["errors"];
};
