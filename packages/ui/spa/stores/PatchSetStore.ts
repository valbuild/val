import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { PatchSets, type SerializedPatchSet } from "../utils/PatchSets";
import { StoreBus } from "./StoreBus";
import type { PatchRecord, SystemEvent } from "./types";
import type { SchemaStore } from "./SchemaStore";
import type { PatchStore } from "./PatchStore";

/**
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
 */
export class PatchSetStore {
  readonly events = new StoreBus<SystemEvent>();

  private patchSets = new PatchSets();
  private schemaStore: SchemaStore;

  constructor(schemaStore: SchemaStore) {
    this.schemaStore = schemaStore;
  }

  /**
   * Reacts to patches existing, NOT to them applying.
   *
   * A patch that fails to apply to source is still a patch the user made and
   * still belongs in the review UI — showing it is how they find out it failed.
   * So this listens to `patch:receive`/`patch:create` rather than to
   * `source:patch-apply`.
   */
  listenTo(patchStore: PatchStore): () => void {
    const handle = (patchIds: PatchId[]) => {
      this.insert(patchStore.recordsFor(patchIds));
    };
    const offReceive = patchStore.events.on("patch:receive", (event) =>
      handle(event.patches),
    );
    const offCreate = patchStore.events.on("patch:create", (event) =>
      handle(event.patches),
    );
    return () => {
      offReceive();
      offCreate();
    };
  }

  private insert(records: PatchRecord[]): void {
    if (records.length === 0) return;
    const touchedPatchSetPaths = new Set<string>();
    for (const record of records) {
      const schema = this.schemaStore.get(record.moduleFilePath);
      for (const op of record.patch) {
        this.patchSets.insert(
          record.moduleFilePath,
          schema,
          op,
          record.patchId,
          // `PatchSets` orders by this, so a missing timestamp must not sort as
          // the epoch and bury a real edit at the bottom of the review list.
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

  /** Async: this is a main-thread-facing read. */
  async getPatchSets(): Promise<SerializedPatchSet> {
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
