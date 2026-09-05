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
  /**
   * Of `patches`, the ones that have already SHIPPED.
   *
   * The id list says what exists; this says what has been committed but not yet
   * deployed. A client never re-fetches a record it already holds, so without
   * this it never learns that somebody else's publish moved a patch it is
   * holding — the patch stayed pending in the scope, the prefix gate read a
   * hole in front of it, and Publish refused for a reason that had stopped
   * being true.
   *
   * Optional: `fs` mode forgets published patches outright, and a server that
   * does not send it leaves the client exactly where it was.
   */
  appliedPatches?: PatchId[];
  /**
   * The newest commit the server has told this client about.
   *
   * The PUBLISH HEAD. Unlike `baseSha`, which only moves once a deployment
   * lands, it moves the instant somebody publishes — so it is the one thing a
   * client can carry to `/save` to say which world it decided against.
   *
   * `undefined` where there is nothing to say (`fs` mode, or no commits yet),
   * and absent leaves the last known head alone rather than clearing it.
   */
  headCommitSha?: string;
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
  /** The publish head. See {@link StatSnapshot.headCommitSha}. */
  private headCommitSha: string | null = null;
  /**
   * The head a local publish moved us off, until one stat has answered with it.
   *
   * `/stat` is asked and answered; a publish in between changes the answer
   * after the question was asked. The response then carries the PRE-publish
   * head, and adopting it puts this client back on a world it has already left
   * — so its next publish names a commit the server has moved past and comes
   * back 409 "someone else published", about its own commit. Auto-publish hits
   * that window on every pause in typing.
   *
   * Ignored for exactly ONE stat, and then cleared. The poll is serial — a
   * request is issued only after the previous one has been answered — so at
   * most one response can have been in flight when the publish landed. Clearing
   * is what keeps a rewind survivable: if the server's head really has gone
   * backwards (a force-push over a published commit), the next stat says so
   * again and is believed, rather than this client being wedged on a commit
   * nobody else has until the page is reloaded.
   *
   * `resyncChain` asks `/stat` outside that serial loop, so two answers CAN be
   * in flight at once; the second would still rewind. That is the bug as it
   * stands today rather than a new one, and closing it needs a per-request
   * sequence number carried on the response.
   */
  private supersededHead: string | null = null;

  /**
   * Adopt a `/stat` result. The id list is authoritative and replaces what we
   * had, rather than being merged into it — the server can reorder.
   */
  receiveStat(snapshot: StatSnapshot): void {
    this.patches = [...snapshot.patches];
    if (snapshot.baseSha !== undefined) {
      this.baseSha = snapshot.baseSha;
    }
    if (snapshot.headCommitSha !== undefined) {
      if (snapshot.headCommitSha === this.supersededHead) {
        // The answer to a question asked before we published. See
        // {@link supersededHead}: ignored once, and then believed.
        this.supersededHead = null;
      } else {
        this.headCommitSha = snapshot.headCommitSha;
        this.supersededHead = null;
      }
    }
    this.events.emit({
      type: "stat:receive",
      patches: [...this.patches],
      ...(snapshot.appliedPatches !== undefined
        ? { appliedPatches: [...snapshot.appliedPatches] }
        : {}),
    });
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
   * The newest commit this client has been told about, or `null`.
   *
   * See {@link StatSnapshot.headCommitSha}. Read rather than carried on the
   * event, for the same reason `baseSha` is: the event says something changed,
   * and a consumer that needs this asks for it.
   */
  currentHeadCommitSha(): string | null {
    return this.headCommitSha;
  }

  /**
   * Move the publish head without waiting for a `/stat` response.
   *
   * Two things know the head has moved before the next poll does: this
   * client's own publish, which gets the sha back from `/save`, and the
   * websocket `commit` message, which is how another author's publish arrives.
   * Neither used to move it, so between a publish and the next poll the head
   * here was the PRE-publish one — and a second publish in that window sent it
   * as `expectedHeadCommitSha`, was compared against the commit this same
   * client had just made, and came back 409 "someone else published". With
   * auto-publish that window is hit on every pause in typing.
   *
   * No event: nothing renders the head, and the one reader asks for it at the
   * moment it publishes.
   */
  setHeadCommitSha(headCommitSha: string): void {
    if (this.headCommitSha !== null && this.headCommitSha !== headCommitSha) {
      this.supersededHead = this.headCommitSha;
    }
    this.headCommitSha = headCommitSha;
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
