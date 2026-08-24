import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Json } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { StoreBus } from "./StoreBus";
import type { Head, PatchOrigin, PatchRecord, SystemEvent } from "./types";
import type { StatStore } from "./StatStore";
import type { SourceStore } from "./SourceStore";
import { noopActivity, type ActivitySink } from "./activity";
import { splitPatchFileOps } from "../hooks/splitPatchFileOps";

/**
 * Fetches the ops for patch ids the system knows about but has no data for.
 *
 * Injected rather than imported so the same store runs against `GET /patches`
 * in the app and against an in-memory table in a test. The signature is the
 * async one on purpose: this is genuinely a network call in the app, and the
 * `external-partial` head only exists because it can be in flight.
 */
export type FetchPatches = (
  patchIds: PatchId[],
) => Promise<{ patches: PatchRecord[]; errors?: Record<PatchId, string> }>;

export type CreatePatchId = () => PatchId;

/**
 * POST one file's bytes to wherever files live, or delete one.
 *
 * `data: null` IS the delete — the same operation in both directions, which is
 * how the server already models it (`saveBase64EncodedBinaryFileFromPatch`
 * deletes when handed null). One method rather than two means a caller cannot
 * upload through the seam and delete around it.
 *
 * Injected like {@link FetchPatches}, so the same store runs against
 * `POST {baseUrl}/patches/{patchId}/files` in FS mode, against the content host
 * in HTTP mode, and against an in-memory table in a test. Async because it is
 * genuinely a network call, and because the ordering below only means anything
 * if it can fail.
 */
export type UploadFile = (request: {
  patchId: PatchId;
  filePath: string;
  /** A data URL, or `null` to delete. */
  data: string | null;
  type: "file" | "image";
  remote: boolean;
  metadata?: Json;
  /**
   * Bytes sent so far, for THIS file.
   *
   * On the seam rather than nowhere, because an image upload is the one operation
   * here slow enough that a user needs to see it moving. The store cannot report
   * it — it does not do the sending — so the implementation reports and the store
   * forwards, adding which file of how many. Optional: an implementation that
   * cannot measure progress simply never calls it.
   */
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
}) => Promise<{ status: "ok" } | { status: "error"; message: string }>;

/** How far a patch's uploads have got. See {@link PatchStore.createPatch}. */
export type UploadProgress = (
  bytesUploaded: number,
  totalBytes: number,
  currentFile: number,
  totalFiles: number,
) => void;

/**
 * The result of creating a patch, which can fail before the patch exists.
 *
 * A union rather than a throw: a field has to render the failure, and an upload
 * failing is an ordinary outcome (offline, quota, a rejected mime type), not an
 * exceptional one.
 */
export type CreatePatchResult =
  | { status: "created"; record: PatchRecord }
  | {
      status: "upload-failed";
      message: string;
      /** Files that were uploaded and have since been cleaned up. */
      rolledBack: string[];
      /** Files that were uploaded and could NOT be cleaned up: orphans. */
      orphaned: string[];
    };

/**
 * Owns the patch chain: which patches exist, in what order, where each came
 * from, and which of them have data.
 *
 * It does NOT apply patches and does not hold source — {@link SourceStore} does
 * that. The split is what makes the head meaningful: the patch store knows a
 * patch exists, the source store knows whether it landed, and the head is where
 * those two facts meet.
 */
export class PatchStore {
  readonly events = new StoreBus<SystemEvent>();

  /** The single linear chain, in apply order. */
  private ordered: PatchId[] = [];
  private dataById = new Map<PatchId, PatchRecord>();
  private originById = new Map<PatchId, PatchOrigin>();
  /** Learned from `source:patch-apply` — the source store is the authority. */
  private appliedIds = new Set<PatchId>();
  private failedById = new Map<PatchId, string>();
  /** Ids announced by stat whose fetch is in flight, so we do not re-fetch. */
  private fetching = new Set<PatchId>();
  /**
   * Which field instance created each locally created patch.
   *
   * The same path can be rendered more than once — a studio field and an inline
   * overlay — so "this session made it" is too coarse to decide who to wake: what
   * is internal to one instance is foreign to the other.
   */
  private creatorByPatchId = new Map<PatchId, string>();
  /**
   * Locally created patches the server has not acknowledged yet.
   *
   * A THIRD axis, deliberately not folded into {@link Head}. The head already
   * carries origin (who made it) and status (did it apply), and "has the server
   * got it" is neither of those: a patch can be internal, applied and complete
   * while still existing only in this tab. Overloading `internal-partial` to
   * mean unsaved would make the read path — which is about whether a VALUE is
   * current — answer a question about durability, and a reader would then have
   * to distinguish "not applied" from "not saved" out of one word.
   *
   * Cleared by {@link markSaved}, not by anything on the read path.
   */
  private pendingIds = new Set<PatchId>();
  /**
   * Bumped whenever the chain or its data changes.
   *
   * A monotonic counter rather than a hash, for the same reason the module
   * revision is one: the only question it answers is "is what I built still
   * current", and that needs one `===`, not a walk.
   */
  private version = 0;

  constructor(
    private readonly fetchPatches: FetchPatches,
    private readonly newPatchId: CreatePatchId = () =>
      crypto.randomUUID() as PatchId,
    private readonly activity: ActivitySink = noopActivity,
    /**
     * Absent means this store cannot accept a patch carrying files at all —
     * which is the honest default, because silently dropping the bytes is the
     * failure mode this whole seam exists to prevent.
     */
    private readonly uploadFile?: UploadFile,
  ) {}

  /**
   * Wiring is explicit and lives here rather than in a central switchboard, so
   * "what does this store react to" is answerable by reading this one method.
   */
  listenTo(stat: StatStore, source: SourceStore): () => void {
    const offStat = stat.events.on("stat:receive", (event) => {
      void this.onStatPatchIds(event.patches);
    });
    const offApply = source.events.on("source:patch-apply", (event) => {
      for (const patchId of event.success) {
        this.appliedIds.add(patchId);
        this.failedById.delete(patchId);
      }
      for (const failure of event.failed) {
        this.failedById.set(failure.patchId, failure.message);
        this.appliedIds.delete(failure.patchId);
      }
      this.events.emit({ type: "patch:head", head: this.currentHead() });
    });
    return () => {
      offStat();
      offApply();
    };
  }

  /**
   * Stat announced the authoritative ordered id list. Anything in it we have no
   * data for gets fetched; the head is `partial` until that lands.
   *
   * The list is adopted wholesale rather than appended to, because stat is the
   * authority on order — another session's patch can land between two of ours.
   * Locally-created ids not yet in stat's list are kept at the end so an
   * optimistic edit does not vanish while its `PUT /patches` is in flight.
   */
  private async onStatPatchIds(patchIds: PatchId[]): Promise<void> {
    const announced = new Set(patchIds);
    for (const patchId of patchIds) {
      if (!this.originById.has(patchId)) {
        this.originById.set(patchId, "external");
      }
    }
    const localTail = this.ordered.filter(
      (patchId) =>
        !announced.has(patchId) && this.originById.get(patchId) === "internal",
    );
    this.ordered = [...patchIds, ...localTail];
    this.version++;

    const missing = patchIds.filter(
      (patchId) => !this.dataById.has(patchId) && !this.fetching.has(patchId),
    );
    this.events.emit({ type: "patch:head", head: this.currentHead() });
    if (missing.length === 0) {
      return;
    }
    for (const patchId of missing) {
      this.fetching.add(patchId);
    }
    // One record per ROUND TRIP, with the batch size, not one per id: the cost
    // being watched here is the request, and a test asserting "one fetch, five
    // ids" would be unable to tell that from five fetches otherwise.
    this.activity.work("patch:fetch", undefined, missing.length);
    const res = await this.fetchPatches(missing);
    const received: PatchId[] = [];
    for (const record of res.patches) {
      this.fetching.delete(record.patchId);
      this.dataById.set(record.patchId, record);
      received.push(record.patchId);
      this.version++;
    }
    for (const [patchId, message] of Object.entries(res.errors ?? {})) {
      this.fetching.delete(patchId as PatchId);
      this.failedById.set(patchId as PatchId, message);
    }
    if (received.length > 0) {
      this.events.emit({ type: "patch:receive", patches: received });
    }
  }

  /**
   * Create a patch locally, uploading any files it carries first.
   *
   * ## Why the order differs for adding and removing a file
   *
   * One rule produces both: **a file must exist for as long as anything
   * references it.**
   *
   * - **Adding** a file: upload, THEN record the patch. The patch is what
   *   references the file, so the bytes have to be there before it exists. Get
   *   this backwards and you get the silent failure this seam is for — the patch
   *   applies, source points at a path, and nothing is there.
   * - **Removing** a file: record the patch, THEN delete. The patch is what
   *   stops referencing it, so deleting first would leave the OLD source
   *   pointing at bytes that are already gone — and if the patch then fails to
   *   record, that is permanent.
   *
   * ## What happens when an upload fails
   *
   * The patch is not created. That is the part that matters, and it is a
   * guarantee: nothing ever references a file that is not there.
   *
   * Files already uploaded for this patch are then deleted, best effort. That is
   * garbage collection, not correctness — an orphan is unreferenced, so it is
   * wasted bytes rather than a broken state, and a rollback that itself fails
   * must not turn a recoverable error into a worse one. So a failed rollback is
   * REPORTED (`orphaned`) rather than retried or thrown: the caller can say "try
   * again" honestly, and something has to know those bytes are now garbage.
   * There is no way to make upload-then-record atomic, so the design does not
   * pretend to.
   *
   * Emitted as `patch:create` rather than `patch:receive` because its data
   * exists immediately; the source store treats the two the same except for the
   * origin it reports to listeners.
   */
  async createPatch(
    moduleFilePath: ModuleFilePath,
    patch: Patch,
    meta?: Record<string, Json>,
    /**
     * The field instance making this edit, so it can be left asleep when the
     * patch lands while every other reader of the path is woken.
     *
     * Positional and optional rather than folded into `meta`: `meta` is
     * persisted and sent to the server, and this is neither — it is meaningless
     * outside this session.
     */
    fieldId?: string,
    /**
     * Where upload progress goes, if the caller is showing it.
     *
     * Threaded through rather than left to the caller to reconstruct: the store is
     * the only thing that knows how many files this patch carries and which one is
     * in flight, and a caller that had to work that out would be re-deriving the
     * split this store already did.
     */
    onProgress?: UploadProgress,
    /**
     * Use THIS id rather than minting one.
     *
     * For a caller that has already committed to an id — it has told something
     * else about it, or applied the patch optimistically somewhere that needs the
     * same identity. Without it, such a caller has to await this call before it
     * can act, and awaiting is exactly what it cannot do: a keystroke that waits
     * for a network-shaped operation before the character appears is a keystroke
     * the user feels.
     *
     * The caller owns uniqueness when it passes one. Reusing an existing id is
     * not checked for, because the only honest response would be to refuse a
     * patch the caller believes it has already made.
     */
    withPatchId?: PatchId,
  ): Promise<CreatePatchResult> {
    const patchId = withPatchId ?? this.newPatchId();
    const { patchOps, fileOps } = splitPatchFileOps(patch);
    const toUpload = fileOps.filter(
      (op): op is typeof op & { value: string } => typeof op.value === "string",
    );
    const toDelete = fileOps.filter((op) => op.value === null);
    if ((toUpload.length > 0 || toDelete.length > 0) && !this.uploadFile) {
      return {
        status: "upload-failed",
        message:
          "This patch carries files, but no upload seam is configured. Refusing rather than dropping the bytes.",
        rolledBack: [],
        orphaned: [],
      };
    }
    const upload = this.uploadFile;

    const uploaded: string[] = [];
    if (upload) {
      for (const op of toUpload) {
        this.activity.work("patch:upload-file", op.filePath);
        const fileIndex = uploaded.length;
        const res = await upload({
          patchId,
          filePath: op.filePath,
          data: op.value,
          type: op.remote ? "file" : "image",
          remote: op.remote,
          metadata: op.metadata,
          onProgress:
            onProgress === undefined
              ? undefined
              : (bytesUploaded, totalBytes) =>
                  onProgress(
                    bytesUploaded,
                    totalBytes,
                    fileIndex,
                    toUpload.length,
                  ),
        });
        if (res.status === "error") {
          // Roll back what did land, then refuse. No patch is created, so
          // nothing references anything missing.
          const rolledBack: string[] = [];
          const orphaned: string[] = [];
          for (const filePath of uploaded) {
            this.activity.work("patch:rollback-file", filePath);
            const undo = await upload({
              patchId,
              filePath,
              data: null,
              type: "image",
              remote: false,
            });
            if (undo.status === "ok") {
              rolledBack.push(filePath);
            } else {
              orphaned.push(filePath);
            }
          }
          return {
            status: "upload-failed",
            message: res.message,
            rolledBack,
            orphaned,
          };
        }
        uploaded.push(op.filePath);
      }
    }

    // Stamped here rather than left to default downstream. The patch-set store
    // orders the review list by this and shows newest first, so an unstamped
    // local edit fell back to the epoch and sorted below every other change —
    // the exact outcome the comment on that fallback said must not happen.
    const record: PatchRecord = {
      patchId,
      moduleFilePath,
      // The HASHED ops, never the bytes. `splitPatchFileOps` explains why the
      // server silently produces no file if this is got wrong.
      patch: patchOps,
      meta,
      createdAt: new Date().toISOString(),
    };
    this.dataById.set(patchId, record);
    this.originById.set(patchId, "internal");
    // Pending from the instant it exists. A locally created patch has by
    // definition not reached the server, and the alternative — marking it
    // pending when a save is attempted — leaves a window in which an edit is
    // real, unsaved, and indistinguishable from a saved one.
    this.pendingIds.add(patchId);
    if (fieldId !== undefined) {
      this.creatorByPatchId.set(patchId, fieldId);
    }
    this.ordered = [...this.ordered, patchId];
    this.version++;
    this.activity.work("patch:create", patchId);
    this.events.emit({ type: "patch:create", patches: [patchId] });

    // Deletes run only now that the patch that stops referencing these files
    // has landed. A failure here leaves an orphan, which is wasted bytes; doing
    // it earlier could leave the old source pointing at bytes already gone.
    if (upload) {
      for (const op of toDelete) {
        this.activity.work("patch:delete-file", op.filePath);
        await upload({
          patchId,
          filePath: op.filePath,
          data: null,
          type: op.remote ? "file" : "image",
          remote: op.remote,
        });
      }
    }
    return { status: "created", record };
  }

  /**
   * Locally created patches the server has not acknowledged, in chain order.
   *
   * Order matters and is not incidental: the server keeps ONE linear chain and
   * checks the `parentRef` of every write, so patches sent out of order are
   * rejected as conflicts. `this.ordered` is already the authority on order, so
   * this filters it rather than keeping a second list that could disagree with
   * it.
   */
  unsavedRecords(): PatchRecord[] {
    const records: PatchRecord[] = [];
    for (const patchId of this.ordered) {
      if (!this.pendingIds.has(patchId)) continue;
      const record = this.dataById.get(patchId);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * An id for a patch that does not exist yet.
   *
   * So a caller can commit to an identity before the async work of creating the
   * patch — see `withPatchId` on {@link createPatch}. Minting one and never using
   * it costs nothing: ids are not registered until a patch is.
   */
  mintPatchId(): PatchId {
    return this.newPatchId();
  }

  /** Does this patch exist only here? */
  isPending(patchId: PatchId): boolean {
    return this.pendingIds.has(patchId);
  }

  /** Everything still local-only. For a "you have unsaved changes" reader. */
  pendingPatchIds(): PatchId[] {
    return this.ordered.filter((patchId) => this.pendingIds.has(patchId));
  }

  /**
   * The server has these. They are no longer local-only.
   *
   * Takes the ids the SERVER named rather than the ids we sent: a partial accept
   * is a shape the response can express, and assuming our list was accepted
   * whole would silently mark an unsaved patch saved — the one bookkeeping error
   * here that loses an edit without any error appearing anywhere.
   */
  markSaved(patchIds: readonly PatchId[]): void {
    const saved: PatchId[] = [];
    for (const patchId of patchIds) {
      if (!this.pendingIds.delete(patchId)) continue;
      saved.push(patchId);
    }
    if (saved.length === 0) return;
    this.version++;
    this.activity.work("patch:mark-saved", undefined, saved.length);
  }

  /**
   * Remove patches from the chain entirely.
   *
   * For a patch the server refused PERMANENTLY (400): it cannot be retried and
   * it cannot be left in place, because the local source shows an edit that will
   * never exist anywhere else. Dropping it and rebuilding is the only outcome
   * that leaves the user looking at something true.
   *
   * Not a general undo. It emits `patch:drop` with the affected modules, and
   * {@link SourceStore} rebuilds those from base + the surviving chain — because
   * an already-applied patch cannot be un-applied, only recomputed without.
   */
  drop(patchIds: readonly PatchId[]): void {
    const dropped: PatchId[] = [];
    const modules = new Set<ModuleFilePath>();
    for (const patchId of patchIds) {
      const record = this.dataById.get(patchId);
      if (record === undefined && !this.ordered.includes(patchId)) continue;
      if (record !== undefined) {
        modules.add(record.moduleFilePath);
      }
      this.dataById.delete(patchId);
      this.originById.delete(patchId);
      this.pendingIds.delete(patchId);
      this.appliedIds.delete(patchId);
      this.failedById.delete(patchId);
      this.creatorByPatchId.delete(patchId);
      this.fetching.delete(patchId);
      dropped.push(patchId);
    }
    if (dropped.length === 0) return;
    const droppedSet = new Set(dropped);
    this.ordered = this.ordered.filter((patchId) => !droppedSet.has(patchId));
    this.version++;
    this.activity.work("patch:drop", undefined, dropped.length);
    this.events.emit({
      type: "patch:drop",
      patches: dropped,
      modules: [...modules],
    });
    // The head may have been the dropped patch. Announced after the drop so a
    // consumer reading `currentHead()` on this event sees the chain as it now
    // is, not as it was.
    this.events.emit({ type: "patch:head", head: this.currentHead() });
  }

  /**
   * Async because this is the boundary a worker would sit behind: everything a
   * field calls has to be a promise from day one, or moving the stores into a
   * worker later means rewriting every caller.
   */
  async getHead(): Promise<Head> {
    return this.currentHead();
  }

  /** In chain order, only those whose data is known. */
  recordsFor(patchIds: readonly PatchId[]): PatchRecord[] {
    const wanted = new Set(patchIds);
    const records: PatchRecord[] = [];
    for (const patchId of this.ordered) {
      if (!wanted.has(patchId)) continue;
      const record = this.dataById.get(patchId);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * The whole chain, in order, for the records whose data is known.
   *
   * Exists so patch sets can be built from the chain ON DEMAND instead of being
   * accumulated on every keystroke. The patch store is already the authority on
   * order and already holds every record, so a second incremental copy of that
   * fact was bookkeeping nobody had asked for.
   */
  allRecords(): PatchRecord[] {
    return this.recordsFor(this.ordered);
  }

  /** Changes whenever the chain does, so a lazy consumer can tell if it is stale. */
  chainVersion(): number {
    return this.version;
  }

  originOf(patchId: PatchId): PatchOrigin {
    return this.originById.get(patchId) ?? "external";
  }

  /**
   * The synchronous read, for other stores only. They share this realm — see
   * {@link StoreBus} — so making them await would buy nothing and would make
   * the apply/emit ordering in {@link SourceStore} impossible to guarantee.
   */
  /**
   * The last patch in the chain.
   *
   * Describes the CHAIN, and nothing reads it to decide whether a value is
   * stale — that is {@link Revision}, owned by the source store. This is for the
   * review UI, for `parentRef`, and for the `patch:head` event.
   */
  currentHead(): Head {
    if (this.ordered.length === 0) {
      return { type: "empty" };
    }
    const patchId = this.ordered[this.ordered.length - 1];
    const origin = this.originOf(patchId);
    const patch = this.dataById.get(patchId) ?? null;
    if (this.failedById.has(patchId)) {
      return { type: `${origin}-failed`, patchId, patch };
    }
    if (patch === null || !this.appliedIds.has(patchId)) {
      return { type: `${origin}-partial`, patchId, patch };
    }
    return { type: `${origin}-complete`, patchId, patch };
  }

  /**
   * Which field instance created this patch, if this session created it.
   *
   * Client-only and never persisted: attribution is only ever needed for patches
   * made here, because a patch from another tab is foreign to every local field
   * by definition. So it never has to survive a round trip — which is why it does
   * not need to be encoded into the patch id.
   */
  creatorOf(patchId: PatchId): string | undefined {
    return this.creatorByPatchId.get(patchId);
  }
}
