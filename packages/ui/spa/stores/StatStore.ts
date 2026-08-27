import type { PatchId } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";

/**
 * The subset of the `/stat` response this prototype reacts to.
 *
 * The real response also carries `schemaSha` / `sourcesSha`, which is how the
 * schema and source stores learn they need to refetch. Left out here because
 * nothing exercises it yet — the field it would add is an input to
 * `SchemaStore.receive`, not a new event.
 *
 * `baseSha` IS here, because the write path needs it and nothing else can supply
 * it: a `PUT /patches` against an empty chain names `{ type: "head", headBaseSha }`
 * as its parent, so without this the first write of a session has nothing honest
 * to send. See `PatchSync.currentParentRef`.
 */
export type StatSnapshot = {
  /** The authoritative ordered patch-id list. Ids only — no ops. */
  patches: PatchId[];
  /**
   * What the chain is rooted at: the sha of the committed base source.
   *
   * Optional so a caller that has no server — a test driving the stores from
   * local modules — is not forced to invent one. Absent means writes cannot be
   * attempted, which is the honest consequence rather than a guessed sha.
   */
  baseSha?: string;
  /**
   * Unpublished changes the server threw away because it could not read them.
   *
   * Carried on stat rather than fetched, because the case worth reporting is a
   * repair that removed EVERYTHING — and then there is nothing left to fetch, so
   * a notice riding on `GET /patches` would never be collected. The server
   * drains it when it hands it over, so it arrives exactly once.
   */
  removed?: { patchId: PatchId; reason: string }[];
};

/**
 * Owns "what does the server say exists right now".
 *
 * It is the only store with an outside input, and it deliberately knows nothing
 * about patch *contents*: `/stat` returns ids, and fetching the ops for them is
 * {@link PatchStore}'s job. Keeping that split is what makes a head of
 * `external-partial` a real state the system passes through rather than a
 * fiction — between `stat:receive` and `patch:receive` the system genuinely
 * knows a patch exists whose ops it has never seen.
 */
export class StatStore {
  readonly events = new StoreBus<SystemEvent>();

  private patches: PatchId[] = [];
  private baseSha: string | null = null;

  /**
   * Adopt a `/stat` result. The id list is authoritative and replaces what we
   * had, rather than being merged into it — the server can reorder.
   */
  receiveStat(snapshot: StatSnapshot): void {
    this.patches = [...snapshot.patches];
    if (snapshot.baseSha !== undefined) {
      this.baseSha = snapshot.baseSha;
    }
    this.events.emit({ type: "stat:receive", patches: [...this.patches] });
    if (snapshot.removed !== undefined && snapshot.removed.length > 0) {
      // A separate event, after the id list: what this says is not "the chain
      // moved", it is "work you made no longer exists anywhere". Only one thing
      // listens for it, and that thing is the toast.
      this.events.emit({
        type: "patch:removed-by-server",
        removed: snapshot.removed,
      });
    }
  }

  currentPatchIds(): PatchId[] {
    return [...this.patches];
  }

  /**
   * What the chain is rooted at, or `null` if no stat has said.
   *
   * Read rather than carried on `stat:receive`, for the same reason the patch
   * ids are carried: the event announces that something changed, and a consumer
   * that needs a value asks. Putting every field of the stat response into the
   * event would make the event the API.
   */
  currentBaseSha(): string | null {
    return this.baseSha;
  }
}
