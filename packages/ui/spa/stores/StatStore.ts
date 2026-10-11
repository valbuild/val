import type { PatchId } from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";

/**
 * The subset of the `/stat` response this prototype reacts to.
 *
 * `sourcesSha` and `schemaSha` say which build answered: the first so its
 * chain is put on that build's source (`BaseAlignment`), the second so a
 * Studio running another schema is told to reload (`SchemaFreshnessWatch`).
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
   * WHICH BUILD answered: the `sourcesSha` of the source its chain is relative to.
   *
   * `patches` are the ones that build does not contain, so they are right only
   * on top of that build's source. The Studio's own source came from ITS bundle,
   * which after a publish can be another build for a while -- the platform's
   * pointer lags per location, and a tab opened before the publish keeps its
   * bundle. See `BaseAlignment`, which reads this.
   *
   * Optional: absent means "not reported", and the chain is applied to whatever
   * base the Studio has, as it always was.
   */
  sourcesSha?: string;
  /**
   * The answering build's `schemaSha` — the same fold `HostStore` runs over the
   * bundle's schemas, so the two can be compared. See `SchemaFreshnessWatch`.
   *
   * Optional: absent means "not reported", and nothing is concluded from it.
   */
  schemaSha?: string;
  /**
   * Every group on the branch and which of `patches` each holds, read in the
   * same transaction as the list and {@link headVersion}.
   *
   * What this client's view of the groups is taken from: on every stat, so a
   * stage or an unstage made in another browser reaches this one with the next
   * stat rather than the next reload. See `PatchStore.receiveStatGroups`.
   * Absent where the server has no groups or predates sending them.
   */
  patchGroups?: PatchGroupT[];
  /**
   * Who `/stat` says is asking, so the system can tell which group is theirs
   * without waiting for the shell to. `null` where it does not know.
   */
  profileId?: string | null;
};

/**
 * Readies the system for a stat BEFORE the stat is adopted.
 *
 * Returns what has to happen in the same turn as the adoption -- or a promise of
 * it, when something must be fetched first -- and that returns whether to adopt
 * the stat at all. `false` holds it back; the next stat is asked again. See
 * `BaseAlignment`.
 */
export type StatPreparer = (
  snapshot: StatSnapshot,
) => (() => boolean) | Promise<() => boolean>;

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
  private baseSha: string | null = null;
  /** See {@link currentSchemaSha}. */
  private schemaSha: string | null = null;
  /** See {@link currentProfileId}. */
  private profileId: string | null = null;
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

  private preparer: StatPreparer | null = null;
  /** Bumped per stat, so a prepared stat that a newer one overtook is dropped. */
  private received = 0;

  /** See {@link StatPreparer}. One, set by `createSystem`. */
  setPreparer(preparer: StatPreparer): void {
    this.preparer = preparer;
  }

  /**
   * Adopt a `/stat` result. The id list is authoritative and replaces what we
   * had, rather than being merged into it — the server can reorder.
   *
   * Through the {@link StatPreparer} when there is one. When it has to fetch,
   * this stat is adopted after the fetch -- and only if no newer stat arrived
   * meanwhile, since a newer answer is the one to believe.
   */
  receiveStat(received: StatSnapshot): void {
    /*
     * The removed-patch notices first, once, and whatever becomes of the rest.
     * The server drains them as it answers, so they are news whether or not
     * this snapshot's chain is ever adopted — dropped as older, overtaken
     * while prepared — and re-adopting it (`readopt`) must not say it twice.
     * Only one thing listens, and that thing is the toast.
     */
    const { removed, ...snapshot } = received;
    if (removed !== undefined) this.noteRemovedByServer(removed);
    if (this.isOlderThanNewest(snapshot)) {
      // Older than an answer already in hand. Dropped before the ticket
      // moves, so it cannot cancel a newer stat still being prepared.
      return;
    }
    if (
      snapshot.schemaSha !== undefined &&
      snapshot.schemaSha !== this.schemaSha
    ) {
      /*
       * After the ordering check — a late answer from before a deploy would
       * otherwise name the old schema to a page that has just reloaded into
       * the new one — but before the preparer: a stat held back while another
       * build's base is fetched still says which schema that build runs.
       */
      this.schemaSha = snapshot.schemaSha;
      this.events.emit({ type: "stat:schema", schemaSha: snapshot.schemaSha });
    }
    if (snapshot.headVersion !== undefined) {
      this.newestHeadVersion = snapshot.headVersion;
    }
    const ticket = ++this.received;
    this.preparing = false;
    const prepared = this.preparer?.(snapshot) ?? null;
    if (prepared === null) {
      this.adopt(snapshot);
    } else if (typeof prepared === "function") {
      if (prepared()) this.adopt(snapshot);
    } else {
      this.preparing = true;
      void prepared.then((commit) => {
        if (ticket !== this.received) return;
        this.preparing = false;
        // The floor can have risen while this was being prepared — our own
        // save lands in between and says, through noteHeadVersion, that the
        // chain is past this answer. Checked again here, since it was only
        // true on arrival.
        if (this.isOlderThanNewest(snapshot)) return;
        // Same turn: nothing renders between the base moving and the chain
        // that belongs on it arriving.
        if (commit()) this.adopt(snapshot);
      });
    }
  }

  private isOlderThanNewest(snapshot: StatSnapshot): boolean {
    return (
      snapshot.headVersion !== undefined &&
      this.newestHeadVersion !== undefined &&
      snapshot.headVersion < this.newestHeadVersion
    );
  }

  /** A stat is waiting on its preparation. See {@link readopt}. */
  private preparing = false;
  private lastAdopted: StatSnapshot | null = null;

  /**
   * Run the last adopted stat through preparation again, as a new stat.
   *
   * For a re-intake (HMR) that put the bundle's source back under another
   * build's chain. As a stat rather than beside one, so it takes a ticket like
   * any other and a newer stat overtakes it. Skipped while a stat is being
   * prepared: that one will put its own base in, and re-running an older one
   * would overtake the newer answer instead.
   */
  readopt(): void {
    if (this.preparing || this.lastAdopted === null) return;
    this.receiveStat(this.lastAdopted);
  }

  private adopt(snapshot: StatSnapshot): void {
    this.lastAdopted = snapshot;
    this.patches = [...snapshot.patches];
    this.headPatchId = snapshot.headPatchId;
    this.headVersion = snapshot.headVersion;
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
    if (snapshot.profileId !== undefined) {
      this.profileId = snapshot.profileId;
    }
    this.events.emit({
      type: "stat:receive",
      patches: [...this.patches],
      ...(snapshot.appliedPatches !== undefined
        ? { appliedPatches: [...snapshot.appliedPatches] }
        : {}),
      ...(snapshot.patchGroups !== undefined
        ? { patchGroups: snapshot.patchGroups }
        : {}),
      ...(snapshot.headVersion !== undefined
        ? { headVersion: snapshot.headVersion }
        : {}),
    });
  }

  /**
   * The server says it removed these unpublished patches.
   *
   * Public for the `/stat` reads made outside the stat intake — the schema
   * check's fresh read, the conflict re-sync. In `fs` mode every `/stat`
   * DRAINS the server's notices, so a caller that read one and dropped them
   * would take the only news that someone's work is gone with it.
   */
  noteRemovedByServer(removed: { patchId: PatchId; reason: string }[]): void {
    if (removed.length === 0) return;
    this.events.emit({ type: "patch:removed-by-server", removed });
  }

  /**
   * A fresh read of which schema the server runs, taken as the latest answer.
   * See `SchemaFreshnessWatch`, which asks it when a cached answer is in doubt.
   */
  noteServedSchemaSha(schemaSha: string): void {
    if (schemaSha === this.schemaSha) return;
    this.schemaSha = schemaSha;
    this.events.emit({ type: "stat:schema", schemaSha });
  }

  /**
   * The `schemaSha` the most recent `/stat` reported, or `null` before one has.
   * See {@link StatSnapshot.schemaSha}.
   */
  currentSchemaSha(): string | null {
    return this.schemaSha;
  }

  /**
   * Who the last stat said is asking, or `null` before one has said. See
   * {@link StatSnapshot.profileId}.
   */
  currentProfileId(): string | null {
    return this.profileId;
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
