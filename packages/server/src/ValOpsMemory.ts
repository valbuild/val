import type { ModuleFilePath, PatchId, ValModules } from "@valbuild/core";
import type { Patch, ParentRef } from "@valbuild/shared/internal";
import {
  ValOps,
  type AuthorId,
  type BaseSha,
  type GenericErrorMessage,
  type MetadataOfType,
  type OpsMetadata,
  type OrderedPatches,
  type OrderedPatchesMetadata,
  type PatchGroupMembership,
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
  delete(patchIds: PatchId[]): Promise<void>;
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
    }
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
 * - **No local binary files.** This configuration uses Val's REMOTE files, so
 *   the four local binary methods refuse by name rather than pretending.
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

  constructor(valModules: ValModules, options: ValOpsMemoryOptions) {
    super(valModules, options);
    this.store = options.patchStore ?? new InMemoryPatchStore();
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

  // #endregion
  // #region remote files only -- these refuse rather than pretend

  private remoteOnly(method: string): never {
    throw new Error(
      `${method} is not available in this mode: it stores a binary file ` +
        `locally, and this configuration uses Val's REMOTE files, where the ` +
        `bytes live on the content host and the patch carries a reference.`,
    );
  }

  override async saveBase64EncodedBinaryFileFromPatch(
    _filePath: string,
    _parentRef: ParentRef,
    _patchId: PatchId,
    _data: string | null,
    _type: "file" | "image",
    _metadata: MetadataOfType<"file" | "image"> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    return this.remoteOnly("saveBase64EncodedBinaryFileFromPatch");
  }

  override async getBase64EncodedBinaryFileFromPatch(
    _filePath: string,
    _patchId: PatchId,
    _remote: boolean,
  ): Promise<Buffer | null> {
    return this.remoteOnly("getBase64EncodedBinaryFileFromPatch");
  }

  protected override async getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image",
  >(
    _filePath: string,
    _type: T,
    _patchId: PatchId,
    _remote: boolean,
  ): Promise<OpsMetadata<T>> {
    return this.remoteOnly("getBase64EncodedBinaryFileMetadataFromPatch");
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
