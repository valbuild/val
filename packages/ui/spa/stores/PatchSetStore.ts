import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { PatchSets, type SerializedPatchSet } from "../utils/PatchSets";
import { StoreBus } from "./StoreBus";
import type { PatchRecord, SystemEvent } from "./types";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * REALM: worker.
 *
 * Groups patches into patch SETS — runs of patches that touch the same place and
 * therefore have to be reviewed, published or reverted together.
 *
 * ## Why this is a separate store from the source store
 *
 * Both stores turn patch ops into paths, so it looks like duplication. It is
 * not: they answer different questions and are wanted at different times.
 *
 * - The source store asks *"who do I have to wake?"*. It needs the exact paths
 *   this patch touched, right now, on the keystroke path.
 * - This store asks *"what are the units of change in this session?"*. It needs
 *   paths COALESCED across many patches, and only when someone opens the review
 *   or publish UI.
 *
 * Folding them together would put patch-set bookkeeping on the keystroke path
 * to serve a screen that is usually not open — which is the shape of the problem
 * this architecture exists to remove.
 *
 * Holds no reference to any other store: it is across a thread boundary, so the
 * patch records and the schemas it needs are pushed in as arguments. That puts
 * the structured clone in the signature rather than hiding it behind a store
 * reference that would silently stop working once this really moved.
 */
/**
 * What one read of the grouping is asked to do.
 *
 * A union rather than a flag plus optional fields, so the payload is exactly the
 * work: `current` carries NOTHING (the common case — a screen re-reading a
 * grouping nothing has changed), `append` carries only the new records and the
 * schemas of the modules they touch, and only `rebuild` carries the chain.
 *
 * `schemas` is scoped to the records in the request, and that is a fix in its own
 * right: the caller used to pass `schemaStore.all()`, every module in the
 * project, in order to group patches that usually touch one.
 */
export type PatchSetRequest =
  | { mode: "current" }
  | {
      mode: "append" | "rebuild";
      records: PatchRecord[];
      schemas: Record<ModuleFilePath, SerializedSchema>;
    };

export class PatchSetStore {
  readonly events = new StoreBus<SystemEvent>();

  private patchSets = new PatchSets();

  constructor(private readonly activity: ActivitySink = noopActivity) {}

  /**
   * Insert these records, optionally throwing away what was there first.
   *
   * Lazy, which was the correction this store's own doc asked for: patch sets
   * are wanted "only when someone opens the review or publish UI", and folding
   * them in "would put patch-set bookkeeping on the keystroke path to serve a
   * screen that is usually not open". The store never folded them in — but the
   * wiring did, calling `insert` on every `patch:create`, so every keystroke paid
   * for a screen that was usually shut.
   *
   * Lazy AND incremental, which is the correction after that. Being lazy was
   * first implemented as "rebuild the whole chain whenever the chain version
   * moved", on the reasoning that the patch store is already the authority on
   * order so no second incremental copy was needed. True, and it made one
   * keystroke cost a re-insert of every patch in the session — and across the
   * worker seam it made the ARGUMENTS the whole chain plus every schema in the
   * project, measured at 1.1 MB cloned per call to do 0.1 ms of work. `PatchSets`
   * was built for incremental insert all along: it keeps `insertedPatches` and
   * exposes `isInserted`.
   *
   * So the caller now says which of the two this is — see `PatchSetChain`, on the
   * host, which is the side that knows whether the chain grew at the end.
   *
   * Driven by patches EXISTING, not by them applying: a patch that failed to
   * apply to source is still a patch the user made and still belongs in the
   * review UI — showing it is how they find out it failed.
   */
  private insertRecords(
    records: PatchRecord[],
    schemas: Record<ModuleFilePath, SerializedSchema>,
    discardFirst: boolean,
  ): void {
    if (discardFirst) {
      this.patchSets.reset();
    }
    const touchedPatchSetPaths = new Set<string>();
    for (const record of records) {
      const schema = schemas[record.moduleFilePath];
      // Per RECORD, with its op count: inserting one patch twice is the bug
      // worth catching here, and a per-op count would hide it behind the
      // op-count difference.
      this.activity.work(
        "patch-set:insert",
        record.patchId,
        record.patch.length,
      );
      for (const op of record.patch) {
        this.patchSets.insert(
          record.moduleFilePath,
          schema,
          op,
          record.patchId,
          // `PatchSets` orders by this and the review list shows newest first,
          // so a missing timestamp buries a real edit at the bottom.
          // `PatchStore.createPatch` now stamps every local patch and the server
          // stamps every remote one, so this fallback is for a record that has
          // neither — where the epoch is at least honest about knowing nothing.
          record.createdAt ?? new Date(0).toISOString(),
          record.authorId ?? null,
        );
        if (op.op !== "file" && op.op !== "test") {
          touchedPatchSetPaths.add(
            `${record.moduleFilePath}?${op.path.join("/")}`,
          );
        }
      }
    }
    this.events.emit({
      type: "patch-set:update",
      patchSetPaths: [...touchedPatchSetPaths],
    });
  }

  /**
   * The grouping, brought up to date as the request says and serialized.
   *
   * Takes its data as arguments, like {@link SearchStore.buildIndex}: this store
   * is in the worker realm, so it could not read a store even if it wanted to,
   * and putting the records in the signature keeps that visible.
   *
   * It does NOT decide what to do — the request already says. That is the point:
   * deciding would mean being handed the whole chain to compare against, which is
   * the payload this split exists to avoid. `PatchSetChain` on the host decides,
   * because the host is the side that saw the change.
   */
  async getPatchSets(request: PatchSetRequest): Promise<SerializedPatchSet> {
    if (request.mode !== "current") {
      this.insertRecords(
        request.records,
        request.schemas,
        request.mode === "rebuild",
      );
    }
    this.activity.work("patch-set:serialize");
    return this.patchSets.serialize();
  }

  /**
   * Drop everything. Called after a publish, when the patches the sets describe
   * no longer exist.
   */
  reset(modules?: ModuleFilePath[]): void {
    // `PatchSets` has no per-module removal, so a partial reset is not something
    // this store can honestly offer yet. Saying so beats quietly resetting
    // everything and having the caller believe it scoped the operation.
    if (modules !== undefined) {
      throw new Error(
        "PatchSetStore.reset: per-module reset is not supported — PatchSets has no per-module removal",
      );
    }
    this.patchSets.reset();
    this.events.emit({ type: "patch-set:update", patchSetPaths: [] });
  }
}
