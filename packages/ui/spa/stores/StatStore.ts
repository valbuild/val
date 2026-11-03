import type { PatchId } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";

/**
 * The subset of the `/stat` response this prototype reacts to.
 *
 * `seq` says whether the project moved, so the manifest is read again
 * (`ManifestSource`) -- and with it, whether the build that answered runs
 * code this Studio does not (`BuildCode`).
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
   * holding, and went on counting it as pending.
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
  /**
   * The head of the PATCH CHAIN: the last patch registered, published or not.
   * `null` when there is none.
   *
   * What the next write names as its parent — see `chainHeadOf`.
   *
   * Replaced with every snapshot, absent included, and never kept from an
   * earlier one: the head is a fact about the same moment as the list, and a
   * head older than its list is a parent the server refuses. Absent means "not
   * reported" (`fs`, or a content service that predates it) and the sync falls
   * back to the last listed id.
   */
  headPatchId?: PatchId | null;
  /**
   * The version of the chain {@link headPatchId} was read at. The content
   * service bumps it with every write and every delete.
   *
   * What lets a stat that arrives AFTER a newer one be recognised as older.
   * `/stat` has more than one caller — the poll, the websocket, the re-sync
   * after a conflict, and React re-announcing what it last held — so two
   * answers can be in flight at once and land in either order, and adopting
   * the late one rewound the chain: the list, and the parent the next write
   * names. A snapshot at a lower version than one already received is
   * dropped.
   *
   * Absent means "not reported" (`fs`, or a content service that predates
   * it), and such a snapshot is adopted as it always was.
   */
  headVersion?: number;
  /**
   * How far along the project's changes the server was when it answered:
   * the `seq` of the answer's `ProjectVersion` (`docs/plans/one-content-model.md`).
   * Every write, delete and publish moves it, so an answer at `seq` N holds
   * everything written up to N. In `http` mode it is the content service's
   * {@link headVersion}, which a socket message moves without a new `/stat`,
   * so read the two through {@link confirmedSeqOf}.
   *
   * What a page is told its server-read content can be refreshed up to (the
   * relay's `confirmed`). Absent from a server that predates versions.
   */
  seq?: number;
  /**
   * WHICH BUILD answered: the `sourcesSha` of the source its chain is relative
   * to. Not read by the stores any more: what each module's base is comes
   * from the manifest, per module (`ManifestSource`). Kept on the snapshot
   * because the answer still carries it, for a Studio of the release before.
   */
  sourcesSha?: string;
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
  /** See {@link StatSnapshot.headPatchId}. `undefined` is "not reported". */
  private headPatchId: PatchId | null | undefined = undefined;
  /**
   * The newest {@link StatSnapshot.headVersion} RECEIVED — not adopted, so a
   * newer stat still being prepared already makes an older one stale.
   */
  private newestHeadVersion: number | undefined = undefined;
  /** The version of the ADOPTED head, which is {@link headPatchId}'s. */
  private headVersion: number | undefined = undefined;
  /** {@link confirmedSeqOf} the ADOPTED stat. */
  private seq: number | undefined = undefined;
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
   * in flight at once. Where the server versions its chain (`headVersion`), the
   * older of the two is dropped on arrival — see {@link StatSnapshot.headVersion}
   * — so this guard is what is left for a server that does not.
   */
  private supersededHead: string | null = null;

  /**
   * Adopt a `/stat` result. The id list is authoritative and replaces what we
   * had, rather than being merged into it — the server can reorder.
   */
  receiveStat(received: StatSnapshot): void {
    /*
     * The removed-patch notices first, once, and whatever becomes of the rest.
     * The server drains them as it answers, so they are news whether or not
     * this snapshot's chain is ever adopted — dropped as older.
     * Only one thing listens, and that thing is the toast.
     */
    const { removed, ...snapshot } = received;
    if (removed !== undefined) this.noteRemovedByServer(removed);
    if (this.isOlderThanNewest(snapshot)) {
      // Older than an answer already in hand.
      return;
    }
    if (snapshot.headVersion !== undefined) {
      this.newestHeadVersion = snapshot.headVersion;
    }
    this.adopt(snapshot);
  }

  private isOlderThanNewest(snapshot: StatSnapshot): boolean {
    return (
      snapshot.headVersion !== undefined &&
      this.newestHeadVersion !== undefined &&
      snapshot.headVersion < this.newestHeadVersion
    );
  }

  private adopt(snapshot: StatSnapshot): void {
    this.patches = [...snapshot.patches];
    this.headPatchId = snapshot.headPatchId;
    this.headVersion = snapshot.headVersion;
    this.seq = confirmedSeqOf(snapshot);
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
      ...(snapshot.headVersion !== undefined
        ? { headVersion: snapshot.headVersion }
        : {}),
      ...(this.seq !== undefined ? { seq: this.seq } : {}),
    });
  }

  /**
   * The server says it removed these unpublished patches.
   *
   * Public for the `/stat` reads made outside the stat intake — the conflict
   * re-sync. In `fs` mode every `/stat`
   * DRAINS the server's notices, so a caller that read one and dropped them
   * would take the only news that someone's work is gone with it.
   */
  noteRemovedByServer(removed: { patchId: PatchId; reason: string }[]): void {
    if (removed.length === 0) return;
    this.events.emit({ type: "patch:removed-by-server", removed });
  }

  currentPatchIds(): PatchId[] {
    return [...this.patches];
  }

  /**
   * The head of the patch chain as the last stat reported it, `null` for an
   * empty chain, or `undefined` when the server does not report one. See
   * {@link StatSnapshot.headPatchId}.
   */
  currentHeadPatchId(): PatchId | null | undefined {
    return this.headPatchId;
  }

  /**
   * A version this client already knows the chain has reached — its own save's
   * — so that a stat read before it is dropped like any other older answer.
   * Only ever raises the floor: it is information about what exists, not a
   * snapshot to adopt, so it changes nothing that has already been adopted.
   */
  noteHeadVersion(version: number): void {
    if (
      this.newestHeadVersion === undefined ||
      version > this.newestHeadVersion
    ) {
      this.newestHeadVersion = version;
    }
  }

  /**
   * The chain version {@link currentHeadPatchId} was read at, or `undefined`
   * when the server does not say. See {@link StatSnapshot.headVersion}.
   */
  currentHeadVersion(): number | undefined {
    return this.headVersion;
  }

  /**
   * How far along the project's changes the ADOPTED stat was read
   * ({@link StatSnapshot.seq}), or `undefined` before one, or from a server
   * that does not say.
   */
  currentSeq(): number | undefined {
    return this.seq;
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

/**
 * The `seq` a stat was read at. `headVersion` first: in `http` mode the two
 * are the same counter (the content service's chain version), and a socket
 * message moves `headVersion` on the stat it updates without a new
 * `version` -- so a stat's `seq` can be older than its own chain there.
 */
export function confirmedSeqOf(
  snapshot: Pick<StatSnapshot, "headVersion" | "seq">,
): number | undefined {
  return snapshot.headVersion ?? snapshot.seq;
}
