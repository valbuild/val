import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Json } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { StoreBus } from "./StoreBus";
import type { Head, PatchOrigin, PatchRecord, SystemEvent } from "./types";
import type { StatStore } from "./StatStore";
import type { SourceStore } from "./SourceStore";
import { noopActivity, type ActivitySink } from "./activity";

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

  constructor(
    private readonly fetchPatches: FetchPatches,
    private readonly newPatchId: CreatePatchId = () =>
      crypto.randomUUID() as PatchId,
    private readonly activity: ActivitySink = noopActivity,
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
   * Create a patch locally. Its data exists immediately — there is nothing to
   * fetch — so it is emitted as `patch:create` rather than `patch:receive`, and
   * the source store treats the two the same except for the origin it reports
   * to listeners.
   */
  async createPatch(
    moduleFilePath: ModuleFilePath,
    patch: Patch,
    meta?: Record<string, Json>,
  ): Promise<PatchRecord> {
    const patchId = this.newPatchId();
    const record: PatchRecord = { patchId, moduleFilePath, patch, meta };
    this.dataById.set(patchId, record);
    this.originById.set(patchId, "internal");
    this.ordered = [...this.ordered, patchId];
    this.activity.work("patch:create", patchId);
    this.events.emit({ type: "patch:create", patches: [patchId] });
    return record;
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

  originOf(patchId: PatchId): PatchOrigin {
    return this.originById.get(patchId) ?? "external";
  }

  /**
   * The synchronous read, for other stores only. They share this realm — see
   * {@link StoreBus} — so making them await would buy nothing and would make
   * the apply/emit ordering in {@link SourceStore} impossible to guarantee.
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
}
