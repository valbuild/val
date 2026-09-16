import type { ModuleFilePath, PatchId, ValModules } from "@valbuild/core";
import type { Patch, ParentRef } from "@valbuild/shared/internal";
import { Internal } from "@valbuild/core";
import { uploadRemoteFile } from "./uploadRemoteFile";
import { getFileExt } from "./getFileExt";
import {
  ValOps,
  bufferFromDataUrl,
  getFieldsForType,
  type AuthorId,
  type BaseSha,
  type GenericErrorMessage,
  type MetadataOfType,
  type OpsMetadata,
  type OrderedPatches,
  type OrderedPatchesMetadata,
  type PatchGroupMembership,
  type PreparedCommit,
  type SaveSourceFilePatchResult,
  type SchemaSha,
  type SourcesSha,
  type ValOpsOptions,
  type WithGenericError,
} from "./ValOps";
import type { HistoryError } from "./history/HistoryError";
import type {
  AffectedFile,
  CommitPage,
  CommitPatch,
  HistoricalCommit,
  StoredModuleVersion,
} from "./history/types";
import { result } from "@valbuild/core/fp";

/**
 * One stored patch. Everything the ordered chain needs and nothing else.
 */
export type StoredPatch = {
  patchId: PatchId;
  path: ModuleFilePath;
  patch: Patch;
  authorId: AuthorId | null;
  createdAt: string;
  baseSha: BaseSha;
};

/**
 * One pending binary file: an upload that has not been published yet.
 *
 * Keyed by the patch that carries it, exactly as `fs` mode keys the directory
 * it writes to. The patch's own `file` op holds a hash, not the bytes, so these
 * arrive on their own request and are joined up by `(patchId, filePath)`.
 */
export type StoredFile = {
  patchId: PatchId;
  /**
   * Where the file will live once published.
   *
   * For a LOCAL file that is `/public/val/photo.jpg`. For a REMOTE one it is
   * the path INSIDE the ref, not the ref itself -- `splitRemoteRef` has already
   * taken it apart by the time the bytes get here, and both readers are keyed
   * the same way. This is why neither takes `remote` into account: the caller
   * has resolved that before it asks.
   */
  filePath: string;
  data: Buffer;
  metadata: MetadataOfType<"file" | "image"> | undefined;
};

/**
 * Where pending patches live.
 *
 * The point of the interface: `ValOpsMemory` is not tied to memory. The default
 * implementation below is explicitly NOT durable -- it dies with the process,
 * or in a Worker with the isolate -- and a durable one (a Durable Object, whose
 * single-threaded execution is the lock Val's fs store builds out of a file)
 * is a swap rather than a rewrite.
 *
 * ORDER IS THE CONTRACT. `list()` returns patch ids in the order they were
 * written, and that order is the chain: entry i's parent is entry i-1. This is
 * the same decision `ValOpsFS` makes with `patches.log` -- the server decides
 * where a patch goes, and it goes last -- and it exists for the same reason: an
 * order held in the patches themselves lets a client working from a stale view
 * strand every patch behind a parent that never landed.
 */
export interface ValPatchStore {
  list(): Promise<PatchId[]>;
  get(patchId: PatchId): Promise<StoredPatch | null>;
  append(patch: StoredPatch): Promise<void>;
  /** The patches AND every file they carry. */
  delete(patchIds: PatchId[]): Promise<void>;

  /**
   * Hold an uploaded file until its patch is published or dropped.
   *
   * Uploads arrive BEFORE the patch record does -- the record's `file` op
   * carries only a hash, so it would otherwise point at nothing. So a file for
   * a patch id that does not exist yet is normal and must be accepted. `fs`
   * mode stages these outside its store and moves them in when the record
   * lands, because a directory of files with no `patch.json` is indistinguishable
   * from a patch whose contents were lost, and its repair pass deletes those.
   * Nothing sweeps this store, so the two-step is not needed here -- at the cost
   * that bytes uploaded for a patch that is never recorded stay until the store
   * is dropped.
   */
  putFile(file: StoredFile): Promise<void>;
  getFile(patchId: PatchId, filePath: string): Promise<StoredFile | null>;
  deleteFile(patchId: PatchId, filePath: string): Promise<void>;
  /** Every file held for a patch, which is what the publish step uploads. */
  filesOf(patchId: PatchId): Promise<StoredFile[]>;
}

/** The default store. Not durable, deliberately and visibly. */
export class InMemoryPatchStore implements ValPatchStore {
  private readonly order: PatchId[] = [];
  private readonly byId = new Map<PatchId, StoredPatch>();

  async list(): Promise<PatchId[]> {
    return [...this.order];
  }

  async get(patchId: PatchId): Promise<StoredPatch | null> {
    return this.byId.get(patchId) ?? null;
  }

  async append(patch: StoredPatch): Promise<void> {
    if (!this.byId.has(patch.patchId)) {
      this.order.push(patch.patchId);
    }
    this.byId.set(patch.patchId, patch);
  }

  async delete(patchIds: PatchId[]): Promise<void> {
    for (const patchId of patchIds) {
      const at = this.order.indexOf(patchId);
      if (at !== -1) {
        this.order.splice(at, 1);
      }
      this.byId.delete(patchId);
      // The bytes go with the patch. They are only reachable through it, so
      // keeping them would be a leak with no reader -- and these are images.
      for (const key of this.files.keys()) {
        if (key.startsWith(`${patchId}\u0000`)) {
          this.files.delete(key);
        }
      }
    }
  }

  // `\u0000` cannot occur in a patch id or a path, so the two halves of the key
  // can never run together into a different pair.
  private static fileKey(patchId: PatchId, filePath: string): string {
    return `${patchId}\u0000${filePath}`;
  }
  private readonly files = new Map<string, StoredFile>();

  async putFile(file: StoredFile): Promise<void> {
    this.files.set(
      InMemoryPatchStore.fileKey(file.patchId, file.filePath),
      file,
    );
  }

  async getFile(
    patchId: PatchId,
    filePath: string,
  ): Promise<StoredFile | null> {
    return (
      this.files.get(InMemoryPatchStore.fileKey(patchId, filePath)) ?? null
    );
  }

  async deleteFile(patchId: PatchId, filePath: string): Promise<void> {
    this.files.delete(InMemoryPatchStore.fileKey(patchId, filePath));
  }

  async filesOf(patchId: PatchId): Promise<StoredFile[]> {
    return [...this.files.values()].filter((file) => file.patchId === patchId);
  }
}

export type ValOpsMemoryOptions = ValOpsOptions & {
  /**
   * The project's source, by path, as the host already holds it.
   *
   * This is why the mode exists. `fs` mode reads `.val.ts` off a disk, and a
   * host that builds and publishes does not have one -- giving it a shimmed
   * filesystem to read through is what produced `Cannot access 'fs' before
   * initialization` and a `/stat` that long-polls watchers which cannot fire.
   * Here the host simply hands the source over.
   */
  sourceFiles: Record<string, string>;
  /** Where pending patches live. Defaults to memory; see ValPatchStore. */
  patchStore?: ValPatchStore;
  /**
   * Val's content host, for pushing remote files at publish.
   *
   * Only needed by {@link ValOpsMemory.uploadRemoteFiles}. A project with no
   * `s.image()` never reaches it.
   */
  contentUrl?: string;
};

/**
 * A `ValOps` for a host that is neither a developer's machine nor
 * content.val.build.
 *
 * EXPERIMENTAL -- see VAL_PROMPT.md.
 *
 * `fs` mode assumes a working tree it can watch and write; `http` mode assumes
 * the content API owns the patch chain and a commit means a git commit. A host
 * that builds and publishes its own output is neither: it holds the source
 * already, it has nowhere to watch, and its "commit" is a new build.
 *
 * What this deliberately does NOT do:
 *
 * - **No filesystem.** Source comes from `sourceFiles`, patches from a store.
 * - **No watching.** `getStat` answers immediately. Nothing can edit files
 *   behind Val's back here: source changes only when the host publishes, and
 *   that replaces the process.
 * - **Pending binary files, but no PUBLISHED local ones.** An upload is held in
 *   the patch store like any other pending change, so the Studio can preview it
 *   before it is published. What this has no answer for is a file that is
 *   already published and served from a `/public` directory: this configuration
 *   uses Val's REMOTE files, where a published image lives on the content host
 *   and the source carries a URL. `getBinaryFile` answers `null` for those --
 *   a miss, not a fault -- and `getBinaryFileMetadata` refuses by name.
 * - **No git history.** There is no repository here, so the history methods
 *   answer `not-supported-in-fs-mode` -- the same closed error `ValOpsFS`
 *   uses, so the History UI degrades the way it already knows how rather than
 *   inventing a commit list. See the note above `listCommits`.
 */
export class ValOpsMemory extends ValOps {
  /**
   * The host's own store -- see {@link ValOps.patchesAreLocal}. `true` for the
   * same reason `fs` mode is: nothing is relayed to a content service, so
   * there is no session to verify against one and no group to separate authors
   * in. Where the two differ is not something a route asks about.
   */
  override readonly patchesAreLocal = true;

  private readonly store: ValPatchStore;
  /**
   * The project's source, keyed WITHOUT a leading slash.
   *
   * Two spellings reach this. A host keys by project-relative path
   * (`src/routes/page.val.ts`) because that is what it built from; Val asks and
   * commits with a leading slash (`/src/routes/page.val.ts`). Normalised on the
   * way in so there is one entry per file — holding both spellings would let a
   * commit update one and leave the other as the stale answer.
   *
   * Not `readonly`: a save replaces the files it rewrote. See
   * {@link adoptPatchedSourceFiles}.
   */
  private sourceFiles: Record<string, string>;
  private readonly contentUrl: string | undefined;

  constructor(valModules: ValModules, options: ValOpsMemoryOptions) {
    super(valModules, options);
    this.store = options.patchStore ?? new InMemoryPatchStore();
    this.contentUrl = options.contentUrl;
    this.sourceFiles = Object.fromEntries(
      Object.entries(options.sourceFiles).map(([path, text]) => [
        ValOpsMemory.key(path),
        text,
      ]),
    );
  }

  // #region the six that carry the mode

  override async onInit(): Promise<void> {
    // Nothing to prepare: there is no directory to create and no store to open.
  }

  /**
   * Requests parked in {@link getStat}, waiting for something to happen.
   *
   * See there for why this exists. Resolved and emptied by
   * {@link announceChange}; never rejected, because a waiter that gives up does
   * so on its own timeout.
   */
  private statWaiters: Array<() => void> = [];

  /** Wake every parked `getStat`. Called by this instance's own writes. */
  private announceChange(): void {
    const waiting = this.statWaiters;
    this.statWaiters = [];
    for (const wake of waiting) {
      wake();
    }
  }

  private async currentStat(): Promise<{
    baseSha: BaseSha;
    schemaSha: SchemaSha;
    sourcesSha: SourcesSha;
    patches: PatchId[];
  }> {
    return {
      baseSha: await this.getBaseSha(),
      schemaSha: await this.getSchemaSha(),
      sourcesSha: await this.getSourcesSha(),
      patches: await this.store.list(),
    };
  }

  override async getStat(
    params: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      patches?: PatchId[];
    } | null,
  ): Promise<{
    type: "request-again" | "no-change" | "did-change";
    baseSha: BaseSha;
    schemaSha: SchemaSha;
    sourcesSha: SourcesSha;
    patches: PatchId[];
  }> {
    /*
     * A long poll, and it has to be one -- but parked on a SIGNAL rather than a
     * timer.
     *
     * The hold is what paces the client. `useStatus.ts` sets `wait: 0` between
     * stats unless it has a WebSocket, with the comment "we are long polling so
     * no point in waiting": the server holding the request open IS the rate
     * limit. An earlier version of this method answered immediately, on the
     * reasoning that nothing can edit files behind Val's back in an isolate --
     * true, and beside the point. It turned a 20s poll into a request every
     * 6ms, which is worse than what it replaced.
     *
     * What was actually wrong with `fs` mode here is not the hold, it is the
     * WATCHING: it races a 250ms mtime poll and an `fs.watch`, neither of which
     * can observe anything in an isolate (the shim's `watch` never fires and
     * mtime is always 0), so it burns CPU for 20s to learn nothing. This owns
     * its store, so it is TOLD instead -- zero timers while parked, and a patch
     * written by another tab is seen at once rather than up to 250ms later.
     *
     * The timeout is the backstop, and it is not only for an idle branch: a
     * store shared between isolates (a Durable Object -- see ValPatchStore) can
     * change without this instance writing anything, and nothing would announce
     * that. So it re-reads on the way out rather than assuming `no-change`.
     */
    const before = await this.currentStat();
    const differs = (now: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      patches: PatchId[];
    }) =>
      params === null ||
      params.baseSha !== now.baseSha ||
      params.schemaSha !== now.schemaSha ||
      (params.patches ?? []).join(",") !== now.patches.join(",");

    // Already behind: answer now. This is the case that matters for latency --
    // the client has just written a patch and is asking what happened.
    if (differs(before)) {
      return { type: "did-change", ...before };
    }

    await this.parkUntilChange();

    const after = await this.currentStat();
    return {
      type: differs(after) ? "did-change" : "no-change",
      ...after,
    };
  }

  /** Resolves on the next write here, or when the poll interval runs out. */
  private parkUntilChange(): Promise<void> {
    const timeoutMs = this.options?.statPollingInterval ?? 20_000;
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        // Cleared on BOTH paths: a change that wins the race leaves a 20s timer
        // behind otherwise, and in a Worker a pending timer is a reason to keep
        // the isolate alive.
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.statWaiters.push(done);
    });
  }

  override async fetchPatches<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  > {
    // An empty `patchIds` means "no filter", not "none": both shipped
    // implementations read it that way and callers rely on it. See
    // `scopedModulePatches` in ValOps.ts, which says why at length.
    const requested =
      filters.patchIds && filters.patchIds.length > 0
        ? new Set<PatchId>(filters.patchIds)
        : null;
    const order = await this.store.list();
    const patches: OrderedPatches["patches"] = [];
    for (const patchId of order) {
      if (requested !== null && !requested.has(patchId)) {
        continue;
      }
      const stored = await this.store.get(patchId);
      if (!stored) {
        continue;
      }
      patches.push({
        patchId: stored.patchId,
        path: stored.path,
        patch: stored.patch,
        createdAt: stored.createdAt,
        authorId: stored.authorId,
        baseSha: stored.baseSha,
        // Nothing here is ever applied-at-a-commit: a publish in this mode
        // rebuilds the site and starts a new process, so a patch that has been
        // applied is a patch this store no longer holds.
        appliedAt: null,
      });
    }
    // The cast is unavoidable: the return type is conditional on a generic
    // TypeScript cannot narrow from a value. `ValOpsFS` does the same.
    return {
      patches: filters.excludePatchOps
        ? patches.map(({ patch: _patch, ...rest }) => ({
            ...rest,
            patch: undefined,
          }))
        : patches,
    } as ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches;
  }

  protected override async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    patchId: PatchId,
    /*
     * Ignored, exactly as in `fs` mode, and named so that is visible.
     *
     * The store's order IS the chain, so the server decides where a patch goes
     * and it goes last. There is no parent to name, and so nothing that can
     * point at nothing. A patch computed against a different state is caught
     * where it shows -- applying it -- rather than by refusing the write.
     */
    _parentRef: ParentRef | null,
    authorId: AuthorId | null,
    _sessionId: string | null,
    /* No shared store and no second author yet, so nothing for a group to
     * separate. Named rather than omitted: TypeScript allows an implementation
     * to take fewer parameters, so dropping it would look identical to
     * handling it. */
    _patchGroup?: PatchGroupMembership,
  ): Promise<SaveSourceFilePatchResult> {
    await this.store.append({
      patchId,
      path,
      patch,
      authorId,
      createdAt: new Date().toISOString(),
      baseSha: await this.getBaseSha(),
    });
    // Any `getStat` parked on this instance answers now instead of waiting out
    // its timeout. This is the whole reason the hold can be free: the store is
    // ours, so there is nothing to poll for.
    this.announceChange();
    return result.ok({ patchId });
  }

  /** One spelling for a path, whichever the caller used. See sourceFiles. */
  private static key(path: string): string {
    return path.replace(/^\//, "");
  }

  /**
   * A save has rewritten these files; they are the committed source now.
   *
   * Without this every save after the first re-reads the source as it was when
   * this object was built, applies only its own patches to that, and parks a
   * file that reverts everything saved before it -- with no error, because
   * applying the patch to the ORIGINAL text succeeds. The Studio auto-saves, so
   * that is not an edge case: it is most of a session's work.
   *
   * `fs` mode gets this for free -- `saveOrUploadFiles` writes the disk that
   * `getSourceFile` reads. There is no disk here, so it is written down.
   */
  protected override adoptPatchedSourceFiles(
    files: Record<string, string | null>,
  ): void {
    for (const [path, text] of Object.entries(files)) {
      const key = ValOpsMemory.key(path);
      if (text === null) {
        delete this.sourceFiles[key];
      } else {
        this.sourceFiles[key] = text;
      }
    }
  }

  protected override async getSourceFile(
    path: string,
  ): Promise<WithGenericError<{ data: string }>> {
    const data = this.sourceFiles[ValOpsMemory.key(path)];
    if (data === undefined) {
      return {
        error: {
          message:
            `File not found: ${path}. In this mode the host hands Val its ` +
            `source, so a missing file means the host did not ship it -- not ` +
            `that it is absent from a disk.`,
        },
      };
    }
    return { data };
  }

  override async deletePatches(patchIds: PatchId[]): Promise<{
    deleted: PatchId[];
    errors?: undefined;
    error?: undefined;
  }> {
    await this.store.delete(patchIds);
    this.announceChange();
    return { deleted: patchIds };
  }

  /**
   * Push this commit's pending binary files to Val's content host.
   *
   * The half of publishing that `commitPrepared` cannot do. Val's remote files
   * upload at PUBLISH, not when the image is added: until then the bytes are a
   * pending change like any other, held by {@link ValPatchStore}. So a publish
   * has to walk the descriptors and push each one before the source that
   * references it goes live -- otherwise the new build ships a URL that 404s.
   *
   * `ValOpsFS.saveOrUploadFiles` does the same loop, alongside two things this
   * has no use for: copying LOCAL binaries into a working tree, and writing the
   * source files (which is `commitPrepared` here). Kept separate rather than
   * shared, because the shapes only look alike.
   *
   * Errors are collected rather than thrown. One image that will not upload
   * should name itself and leave the rest of the publish decidable, rather than
   * failing a save that has already applied its patches.
   */
  async uploadRemoteFiles(
    preparedCommit: Pick<PreparedCommit, "patchedBinaryFilesDescriptors">,
    auth: { apiKey: string } | { pat: string },
  ): Promise<{
    uploaded: string[];
    errors: Record<string, GenericErrorMessage>;
  }> {
    const uploaded: string[] = [];
    const errors: Record<string, GenericErrorMessage> = {};
    const project = this.options?.config.project;
    const remote = Object.entries(
      preparedCommit.patchedBinaryFilesDescriptors,
    ).filter(([, descriptor]) => descriptor.remote);

    if (remote.length === 0) {
      return { uploaded, errors };
    }
    if (!this.contentUrl || !project) {
      // Named separately from a failed upload: nothing was attempted, and the
      // fix is configuration rather than a retry.
      for (const [ref] of remote) {
        errors[ref] = {
          message:
            "Cannot publish a remote file: this server has no " +
            (!project ? "`project` in val.config" : "content host configured") +
            ". Remote files need both, plus an api key.",
        };
      }
      return { uploaded, errors };
    }

    for (const [ref, { patchId }] of remote) {
      const split = Internal.remote.splitRemoteRef(ref);
      if (split.status === "error") {
        errors[ref] = { message: "Failed to split remote ref: " + ref };
        continue;
      }
      const bytes = await this.getBase64EncodedBinaryFileFromPatch(
        split.filePath,
        patchId,
      );
      if (!bytes) {
        errors[ref] = {
          message: `No bytes held for ${ref} (patch ${patchId}). The upload either never arrived or was dropped with its patch.`,
        };
        continue;
      }
      const res = await uploadRemoteFile(
        this.contentUrl,
        project,
        split.bucket,
        split.fileHash,
        getFileExt(split.filePath),
        bytes,
        auth,
      );
      if (!res.success) {
        errors[ref] = { message: res.error };
        continue;
      }
      uploaded.push(ref);
    }
    return { uploaded, errors };
  }

  // #endregion
  // #region published local files -- these refuse rather than pretend

  private remoteOnly(method: string): never {
    throw new Error(
      `${method} reads a PUBLISHED file from a local directory, and this ` +
        `configuration uses Val's REMOTE files: a published file lives on the ` +
        `content host and the source carries its URL. Pending uploads are held ` +
        `here and do work -- see saveBase64EncodedBinaryFileFromPatch.`,
    );
  }

  override async saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    /*
     * Ignored, as in `fs` mode: the file is keyed by the patch that carries it,
     * so there is no parent to resolve.
     */
    _parentRef: ParentRef,
    patchId: PatchId,
    data: string | null,
    _type: "file" | "image",
    metadata: MetadataOfType<"file" | "image"> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    if (data === null) {
      // `null` records a DELETION. This is why the byte-taking sibling cannot
      // replace this method: there would be nothing to hand it.
      await this.store.deleteFile(patchId, filePath);
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
    await this.store.putFile({ patchId, filePath, data: buffer, metadata });
    return { patchId, filePath };
  }

  override async getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
    /*
     * Not consulted, and `fs` mode does not consult it either: a remote ref has
     * already been split by the caller, so what arrives here is the path inside
     * it and the pair (patchId, filePath) is the whole key.
     */
    _remote?: boolean,
  ): Promise<Buffer | null> {
    return (await this.store.getFile(patchId, filePath))?.data ?? null;
  }

  protected override async getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image",
  >(
    filePath: string,
    type: T,
    patchId: PatchId,
    _remote?: boolean,
  ): Promise<OpsMetadata<T>> {
    const file = await this.store.getFile(patchId, filePath);
    if (!file || file.metadata === undefined) {
      return { errors: [{ message: "Metadata file not found", filePath }] };
    }
    /*
     * Checked, not trusted. The metadata is whatever the client sent with the
     * upload, and a missing `width` on an image is the difference between a
     * layout that reserves space and one that jumps -- reported here, where the
     * field is named, rather than surfacing as an undefined further on.
     */
    const fieldErrors = getFieldsForType(type)
      .filter((field) => !(field in file.metadata!))
      .map((field) => ({
        message: `Expected fields for type: ${type}. Field not found: '${field}'`,
        field,
      }));
    if (fieldErrors.length > 0) {
      return { errors: fieldErrors };
    }
    return { metadata: file.metadata } as OpsMetadata<T>;
  }

  override async getBinaryFile(_filePathOrRef: string): Promise<Buffer | null> {
    // Null rather than a throw: callers treat this as "no such file", and a
    // read of a local file in a remote-files project is a miss, not a fault.
    return null;
  }

  protected override async getBinaryFileMetadata<T extends "file" | "image">(
    _filePath: string,
    _type: T,
  ): Promise<OpsMetadata<T>> {
    return this.remoteOnly("getBinaryFileMetadata");
  }

  // #endregion
  // #region no git here

  // The same answer `ValOpsFS` gives, for the same reason and reusing its
  // error: history is a thing the content service holds, and there is no
  // repository behind this mode either. `not-supported-in-fs-mode` is the
  // closed union's member for exactly that, and the Studio already knows how
  // to show it -- a mode-specific member would be a new state to write UI for
  // that says the same sentence.

  override async listCommits(): Promise<
    result.Result<CommitPage, HistoryError>
  > {
    return result.err({ kind: "not-supported-in-fs-mode" });
  }

  override async getCommitPatches(): Promise<
    result.Result<
      { commit: HistoricalCommit; patches: CommitPatch[] },
      HistoryError
    >
  > {
    return result.err({ kind: "not-supported-in-fs-mode" });
  }

  override async getCommitModules(): Promise<
    result.Result<
      { modules: StoredModuleVersion[]; complete: boolean },
      HistoryError
    >
  > {
    return result.err({ kind: "not-supported-in-fs-mode" });
  }

  override async getCommitAffectedFiles(): Promise<
    result.Result<AffectedFile[], HistoryError>
  > {
    return result.err({ kind: "not-supported-in-fs-mode" });
  }

  override async getFileAtCommit(): Promise<
    result.Result<Buffer, HistoryError>
  > {
    return result.err({ kind: "not-supported-in-fs-mode" });
  }

  override gitPathOfModule(
    // Unused: there is no repository for a module path to be relative to.
    _moduleFilePath: ModuleFilePath,
  ): result.Result<string, HistoryError> {
    return result.err({ kind: "not-supported-in-fs-mode" });
  }
  // #endregion history
}

/** Kept exported so a host can name the error shape it may get back. */
export type ValOpsMemoryError = GenericErrorMessage;
