import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { ParentRef, Patch } from "@valbuild/core/patch";
import { StoreBus } from "./StoreBus";
import type { PatchRecord, SystemEvent } from "./types";
import type { PatchStore } from "./PatchStore";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * `PUT /patches`, as a seam.
 *
 * Injected like `FetchPatches` and `UploadFile`, so the same logic runs against
 * the real endpoint, against a content host, and against a table in a test. The
 * result is a union rather than a thrown error because every branch of it is an
 * ORDINARY outcome that has to be handled differently:
 *
 * - `saved` — the server has them.
 * - `conflict` (409) — our parent is no longer the head. Someone else wrote.
 *   Retryable, and the only branch that needs the chain re-synced first.
 * - `rejected` (400) — the patches are permanently bad. NOT retryable.
 * - `network-error` — retryable, and says nothing about the patches.
 * - `unparseable-response` — retryable, but usually permanent: reported after a
 *   couple of attempts instead of retried in silence.
 * - `unauthorized` — retryable only after the user does something.
 *
 * Collapsing conflict and rejected into one "failed" would be the expensive
 * mistake: one must be retried and the other must never be, and getting it
 * backwards either loses an edit forever or retries a bad patch until the end of
 * time.
 */
export type SavePatches = (request: {
  patches: { path: ModuleFilePath; patchId: PatchId; patch: Patch }[];
  parentRef: ParentRef;
  sessionId?: string | null;
  patchGroup?: PatchGroupMembership;
}) => Promise<SaveResult>;

/**
 * Which patch group a write joins, and what it drags in with it.
 *
 * `alsoAddPatchIds` is the CLOSURE: the patches that share a patch set with the
 * ones being written and must therefore move with them. Sending the group's
 * current membership instead would be a no-op — the server set-unions it — and
 * would miss the case the feature exists for: another author's array insert
 * has to join your group when you edit that array, or your op lands on the
 * wrong element.
 */
export type PatchGroupMembership = {
  /**
   * Deliberately absent on the write path.
   *
   * The server resolves "this author's open group on this branch, creating it
   * if absent" when no id is named — `patchGroupId ?? null` triggers
   * `getOrCreateOpen`. Naming one from the client means holding an id across
   * publishes, and a published group is refused: the stale id would fail the
   * write and lose the save. The server always knows which group is current;
   * the client does not.
   *
   * Explicit stage and unstage DO name one, because they act on a specific
   * group rather than on whichever is open.
   */
  patchGroupId?: string;
  alsoAddPatchIds: PatchId[];
  closureVersion: number;
};

/**
 * Who can answer "which group does this write join, and what comes with it".
 *
 * A seam, like `savePatches` and `resyncChain`, and for the same reason: the
 * closure needs patch sets, which need the schema, and neither is visible from
 * here. Whatever holds that knowledge registers itself.
 *
 * `undefined` — the resolver is absent, or answers `undefined` — means write
 * without a group, which is exactly what this client did before groups existed
 * and what `fs` mode and any content API without them keep doing.
 */
export type PatchGroupResolver = (
  patchIds: PatchId[],
) => PatchGroupMembership | undefined;

export type SaveResult =
  | {
      status: "saved";
      newPatchIds: PatchId[];
      parentRef: ParentRef;
      /**
       * Which group the server put these patches in, where it has groups.
       *
       * The write names no group, so this is the ONLY way the client learns the
       * id of the group its own first write created — see
       * `PatchStore.ownPatchGroupId`. Absent in `fs` mode and against a content
       * API that predates groups.
       */
      patchGroupId?: string;
    }
  | { status: "conflict"; message: string }
  | {
      status: "rejected";
      message: string;
      errors?: Record<ModuleFilePath, string[]>;
    }
  | { status: "network-error"; message: string }
  /**
   * The server answered, and the answer was not one this client understands.
   *
   * Separate from `network-error`, which it used to be folded into, because the
   * two have opposite prognoses. A network error is usually transient — the
   * laptop's lid was shut — and retrying until it clears is right. An answer that
   * does not parse is usually PERMANENT: a Val version mismatch between the app
   * and the editor, or something in front of the server returning HTML. Retrying
   * that succeeds never, so it must be said out loud rather than absorbed.
   *
   * Still retried, though, and the patches are still kept. "Usually permanent" is
   * not "certainly permanent" — a dev server recompiling an API route answers
   * exactly like this for a second or two — and giving up would throw away an
   * edit over a transient.
   */
  | { status: "unparseable-response"; message: string }
  | { status: "unauthorized"; message: string };

/**
 * Bring the chain back in step with the server, after a conflict.
 *
 * Supplied rather than done here, because re-syncing means `GET /stat` then
 * `GET /patches` then handing both to the stores — which is the system's job,
 * not this file's. What this file owns is the DECISION that a re-sync is needed
 * and the fact that the retry must wait for it.
 */
export type ResyncChain = () => Promise<void>;

/**
 * How many failed attempts before a retry is reported rather than just retried.
 *
 * Two, because the first failure of anything is usually nothing: a dev server
 * recompiling its API route, a proxy reconnecting, one dropped packet. By the
 * third the backoff has already reached two seconds and whatever is wrong is not
 * a blip. The retry continues either way — this only decides when someone is told.
 */
export const SAVE_STUCK_AFTER_ATTEMPTS = 2;

/**
 * What the write queue is doing. The queue only — see {@link SaveRejection}.
 */
export type SyncState =
  /** Everything local is on the server. */
  | { status: "in-sync" }
  /** Local edits exist that have not been sent yet. */
  | { status: "pending"; patches: PatchId[] }
  | { status: "saving"; patches: PatchId[] }
  /**
   * A save failed in a way that will be retried, with the reason and when.
   *
   * `attempt` is exposed because a UI that shows "retrying..." forever is worse
   * than one that shows "retrying, attempt 4" — the second is a user's only clue
   * that something is actually wrong.
   */
  | {
      status: "retrying";
      patches: PatchId[];
      reason:
        | "conflict"
        | "network-error"
        | "unparseable-response"
        | "unauthorized";
      message: string;
      attempt: number;
    };

/**
 * The write-back loop.
 *
 * ## Why this is a store and not a method on `PatchStore`
 *
 * Everything else in this system is demand-driven: a change MARKS and a read
 * COMPUTES, so nothing is ever paid for unless somebody is looking. A write
 * cannot work that way. An edit the user made has to reach the server whether or
 * not anything reads it again, and nobody is going to "demand" durability. So
 * the write needs a driver of its own, and putting it in the patch store would
 * make that store — which every read path touches — the owner of a retry timer
 * and a network state machine.
 *
 * ## Why the writes are serialized
 *
 * The server keeps ONE linear chain and checks the `parentRef` of every write.
 * Two writes in flight at once means the second one's parent is a patch the
 * server may not have accepted yet, which is a 409 by construction — a conflict
 * this client caused itself and would then "resolve" by re-sending. So at most
 * one `PUT` is in flight, and a save requested while one is running sets a flag
 * that makes the current one loop again rather than starting a second.
 *
 * ## Why a batch, and what the batch is
 *
 * Every unsaved patch, in chain order, in one request. Forty keystrokes must not
 * be forty round trips; and because the whole batch shares one `parentRef`, they
 * must go in one request or the second would have to name the first as its
 * parent before the server has confirmed it.
 *
 * ## The parent ref
 *
 * `{ type: "patch", patchId }` of the last patch the SERVER has acknowledged,
 * falling back to `{ type: "head", headBaseSha }` when it has acknowledged none.
 * Deliberately not the local head: the local head includes patches the server has
 * never seen, and naming one of those as a parent is a guaranteed 409.
 *
 * "What the server has acknowledged" is two things joined, not one: the last
 * stat's id list, plus the ids our own 200s named that the stat has not caught up
 * to. A stat can be older than our own write, so using it alone would walk the
 * parent backwards and conflict with ourselves.
 */
/**
 * Is this the same queue state?
 *
 * Compared by content rather than by reference because {@link SyncState} values
 * are built fresh at every decision point — the alternative is announcing a
 * change on every drain and making a UI flicker between two identical states.
 */
/**
 * The leading records whose session matches `session`.
 *
 * Stops at the first that differs rather than filtering, because the chain is
 * linear — see the call site.
 */
function takeWhileSameSession(
  records: PatchRecord[],
  session: string | undefined,
  sessionOf: (patchId: PatchId) => string | undefined,
): PatchRecord[] {
  const batch: PatchRecord[] = [];
  for (const record of records) {
    if (sessionOf(record.patchId) !== session) {
      break;
    }
    batch.push(record);
  }
  return batch;
}

function sameState(a: SyncState, b: SyncState): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "in-sync" || b.status === "in-sync") {
    return true;
  }
  const same =
    a.patches.length === b.patches.length &&
    a.patches.every((patchId, index) => patchId === b.patches[index]);
  if (!same) {
    return false;
  }
  if (a.status === "retrying" && b.status === "retrying") {
    return a.attempt === b.attempt && a.reason === b.reason;
  }
  return true;
}

export class PatchSync {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * What the chain is rooted at. `null` until a stat arrives.
   *
   * While it is null a save cannot be attempted at all, because there is no
   * honest value for `parentRef`: `{ type: "head" }` needs this sha, and
   * guessing one would write against the wrong base.
   */
  private baseSha: string | null = null;
  /** The server's ordered patch ids, as of the last stat. */
  private statPatchIds: PatchId[] = [];
  /**
   * Patches the server has acknowledged that the last stat did not list yet.
   *
   * This list is the whole reason the parent ref is computed rather than stored.
   * A stat snapshot can be OLDER than our own successful write — it may have
   * been taken before the write landed — so taking the last stat id as the parent
   * would walk the parent backwards and make our next write conflict with
   * ourselves. Ids leave this list only when a stat finally lists them, at which
   * point the two agree and it no longer matters which one answered.
   */
  private savedNotInStat: PatchId[] = [];
  private inFlight: Promise<void> | null = null;
  private attempt = 0;
  /** See {@link reportStuck}: one report per spell of failure, not per attempt. */
  private reportedStuck = false;
  private state: SyncState = { status: "in-sync" };
  private stopped = false;

  constructor(
    private readonly patchStore: PatchStore,
    /**
     * Absent means this system does not write at all.
     *
     * Deliberately not a no-op that reports success, and deliberately not a
     * stub that returns a retryable error either — the first would call every
     * edit saved while nothing left the tab, and the second spins a retry loop
     * forever against a server that does not exist. Absent is its own state:
     * {@link drain} reports `pending` and stops.
     */
    private readonly savePatches: SavePatches | undefined,
    private readonly resync: ResyncChain,
    private readonly activity: ActivitySink = noopActivity,
    /**
     * Passed to the server so it can attribute a write to this editing session.
     * Optional because it is metadata: nothing here branches on it.
     */
    private readonly sessionId?: string | null,
    /**
     * How long to wait before retrying, per attempt. Injected so a test does not
     * have to wait real seconds to exercise the retry — the alternative is a
     * test that is either slow or fake.
     */
    private readonly backoffMs: (attempt: number) => number = (attempt) =>
      Math.min(30_000, 500 * 2 ** (attempt - 1)),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /**
   * Save on every local patch.
   *
   * `patch:create` and nothing else: `patch:receive` is a patch from somewhere
   * else, which by definition the server already has. Writing those back would
   * duplicate every foreign edit into the chain.
   */
  listenTo(): () => void {
    return this.patchStore.events.on("patch:create", () => {
      void this.flush();
    });
  }

  /**
   * What the server says exists. Called from `stat:receive`.
   *
   * Ids the stat now lists are dropped from {@link savedNotInStat}: the two
   * sources of truth have converged on those, so keeping them would be keeping a
   * duplicate.
   */
  receiveStat(headBaseSha: string, serverPatchIds: readonly PatchId[]): void {
    this.baseSha = headBaseSha;
    this.statPatchIds = [...serverPatchIds];
    const known = new Set(serverPatchIds);
    this.savedNotInStat = this.savedNotInStat.filter(
      (patchId) => !known.has(patchId),
    );
  }

  /**
   * These patches are gone from the server. Stop naming them as a parent.
   *
   * The counterpart to {@link receiveStat}, and the reason it cannot do this
   * job itself: a stat drops an id from {@link savedNotInStat} by LISTING it,
   * because a snapshot that omits a just-saved patch is usually only stale. A
   * DELETED patch is never listed again, so it would sit there naming itself the
   * parent of every future write for as long as the tab is open.
   *
   * That is not a slow recovery, it is no recovery: the chain is linear, so a
   * parent the server does not hold is refused — and refused as
   * `Parent patch not found` with a status that is not 409, which {@link handle}
   * reads as permanent and answers by DROPPING the patch. One discard therefore
   * cost every edit made after it, one toast at a time, until a reload.
   *
   * Called from the `patch:drop` listener in `createSystem`, so it covers a
   * discard made here, a discard made in another tab (`reconcileVanished` drops
   * what stat has stopped naming), and a patch the server refused — rather than
   * only the one path that happened to be reported.
   *
   * One drop is not a deletion: `discardUnapplicable` gives up on a patch the
   * server will not delete and drops it locally anyway, saying so in the
   * console. That patch is still the server's head, so forgetting it names the
   * one BEFORE it — a parent that exists but is no longer the tip, which is a
   * 409, which re-syncs and retries. A round trip and no more. Cheap,
   * self-correcting, and on a path that has already announced it is broken; the
   * alternative is for this to know WHY each patch left, which is knowledge
   * `patch:drop` does not carry and should not have to.
   */
  forget(patchIds: readonly PatchId[]): void {
    if (patchIds.length === 0) {
      return;
    }
    const gone = new Set(patchIds);
    this.savedNotInStat = this.savedNotInStat.filter(
      (patchId) => !gone.has(patchId),
    );
    // The stat list too: it is the other half of the parent, and between a
    // discard and the socket message announcing it the two are equally stale.
    this.statPatchIds = this.statPatchIds.filter(
      (patchId) => !gone.has(patchId),
    );
  }

  currentState(): SyncState {
    return this.state;
  }

  /**
   * What the next write names as its parent.
   *
   * Computed, not stored — see {@link savedNotInStat}. Deliberately ignores the
   * LOCAL head: that includes patches the server has never seen, and naming one
   * of those as a parent is a guaranteed 409.
   */
  /**
   * Set by whatever can compute the closure — see {@link PatchGroupResolver}.
   *
   * Registered after construction, like `PatchStore.setParentRefSource`, for the
   * same reason: the thing that knows the answer is built later than the sync
   * that needs it.
   */
  private patchGroupResolver: PatchGroupResolver | undefined;

  setPatchGroupResolver(resolver: PatchGroupResolver | undefined): void {
    this.patchGroupResolver = resolver;
  }

  currentParentRef(): ParentRef | null {
    if (this.baseSha === null) {
      return null;
    }
    const patchId =
      this.savedNotInStat[this.savedNotInStat.length - 1] ??
      this.statPatchIds[this.statPatchIds.length - 1];
    if (patchId === undefined) {
      return { type: "head", headBaseSha: this.baseSha };
    }
    return { type: "patch", patchId };
  }

  /**
   * Send everything unsaved, and keep going until nothing is left.
   *
   * Awaitable so a test — and a "save before you navigate away" caller — can
   * wait for the write rather than sleeping. A second call while one is running
   * returns the SAME promise: two callers both wanting the queue drained want the
   * same thing, and giving them one promise is what keeps a single write in
   * flight.
   */
  async flush(): Promise<void> {
    if (this.inFlight !== null) {
      // CHAINED, not flagged. The first version of this set an `again` flag and
      // returned the in-flight promise, which had a window that silently lost a
      // write: a flush arriving after the running drain had finished looping but
      // before its `finally` cleared `inFlight` set the flag on a loop that would
      // never read it again, and the patch then sat unsaved until something else
      // happened to flush. Chaining has no such window — the follow-up flush is
      // scheduled rather than signalled — and it costs one promise per caller
      // that finds nothing left to do.
      return this.inFlight.then(() => this.flush());
    }
    const run = this.drain().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async drain(): Promise<void> {
    // A loop, not recursion: a save that keeps failing would otherwise grow the
    // stack once per retry, and this loop is expected to run for as long as the
    // network is down.
    for (;;) {
      const records = this.patchStore.unsavedRecords();
      if (records.length === 0) {
        this.setState({ status: "in-sync" });
        return;
      }
      if (this.stopped) {
        return;
      }
      const save = this.savePatches;
      if (save === undefined) {
        // Nowhere to write. Reported as pending rather than retrying, because
        // there is nothing to retry: no amount of waiting configures a seam.
        this.setState({
          status: "pending",
          patches: records.map((record) => record.patchId),
        });
        return;
      }
      const parentRef = this.currentParentRef();
      /**
       * The longest LEADING run of unsaved patches sharing one session.
       *
       * The `PUT` carries a single `sessionId` for the whole request and the
       * server records it against every patch in it, so a batch spanning two
       * sessions would mislabel one of them. And it has to be a leading run
       * rather than a filter: the chain is linear and the server checks the
       * parent, so patches can only be sent in order — skipping one to group by
       * session would name a parent the server has not accepted.
       *
       * Patches from the other session go in the next round trip, which the loop
       * takes because `unsavedRecords()` will still be non-empty.
       */
      const session = this.patchStore.sessionOf(records[0].patchId);
      const batch = takeWhileSameSession(records, session, (patchId) =>
        this.patchStore.sessionOf(patchId),
      );
      const patchIds = batch.map((record) => record.patchId);
      if (parentRef === null) {
        // No stat yet, so there is no honest parent. Reported as retrying
        // rather than as an error: the edits are safe locally and the very next
        // stat unblocks them.
        this.setState({
          status: "retrying",
          patches: patchIds,
          reason: "network-error",
          message:
            "Cannot save yet: the server has not said what the chain starts from.",
          attempt: this.attempt,
        });
        return;
      }
      this.setState({ status: "saving", patches: patchIds });
      this.activity.work("patch:save", undefined, batch.length);
      this.events.emit({ type: "patch:save", patches: patchIds, parentRef });
      /*
       * Resolved per BATCH, against the chain as it stands now.
       *
       * Not at create time: a patch is written some time after it is made, and
       * a patch set can coalesce in between — another author's insert can make
       * two previously separate sets into one. The closure that matters is the
       * one true when the write goes out, since that is what the server unions
       * into the group.
       */
      const patchGroup = this.patchGroupResolver?.(patchIds);
      const result = await save({
        patches: batch.map((record) => ({
          path: record.moduleFilePath,
          patchId: record.patchId,
          patch: record.patch,
        })),
        parentRef,
        // The batch's session, not the system's: a session belongs to the patches
        // that were made in it.
        sessionId: session ?? this.sessionId,
        ...(patchGroup ? { patchGroup } : {}),
      });
      if (this.stopped) {
        return;
      }
      const done = await this.handle(result, patchIds);
      if (done) {
        return;
      }
    }
  }

  /** Returns true when the loop should stop. */
  private async handle(result: SaveResult, sent: PatchId[]): Promise<boolean> {
    if (result.status === "saved") {
      this.attempt = 0;
      this.reportedStuck = false;
      this.savedNotInStat.push(...result.newPatchIds);
      // The ids the SERVER named, not the ids we sent — see `markSaved`.
      this.patchStore.markSaved(result.newPatchIds);
      if (result.patchGroupId !== undefined) {
        // Before the event, so anything woken by `patch:saved` already sees the
        // group its patches landed in.
        this.patchStore.recordOwnPatchGroup(result.patchGroupId);
      }
      this.events.emit({
        type: "patch:saved",
        patches: result.newPatchIds,
        parentRef: result.parentRef,
      });
      // Keep looping. More may have been created while this request was in
      // flight, and the loop's own emptiness check is what terminates it — a
      // second condition here would be a second place to get it wrong.
      return false;
    }
    if (result.status === "rejected") {
      this.reportedStuck = false;
      // Permanently bad, so this is the one branch that destroys local state.
      // The patches are dropped and the source rebuilt without them, because the
      // alternative is a user staring at an edit that will never exist.
      this.attempt = 0;
      this.patchStore.drop(sent);
      this.events.emit({
        type: "patch:save-rejected",
        patches: sent,
        message: result.message,
        errors: result.errors,
      });
      // NOT `return true`. The queue may still hold patches created while this
      // request was in flight, and they have done nothing wrong — stopping here
      // would strand them unsaved because an unrelated patch was refused.
      return false;
    }
    this.attempt++;
    if (result.status === "conflict") {
      this.activity.work("patch:save-conflict");
      // Our idea of the head was wrong, so every id we were holding on that
      // basis is suspect. Dropped rather than kept: the re-sync below replaces
      // them with what the server actually has, and a stale entry here would
      // make the retry name the same rejected parent again.
      this.savedNotInStat = [];
      this.setState({
        status: "retrying",
        patches: sent,
        reason: "conflict",
        message: result.message,
        attempt: this.attempt,
      });
      this.events.emit({
        type: "patch:save-conflict",
        patches: sent,
        message: result.message,
      });
      // Re-sync BEFORE the retry, and before the backoff: a conflict means our
      // parent is wrong, so retrying without a new parent is guaranteed to
      // conflict again. This is the whole reason `ResyncChain` is injected.
      await this.resync();
      if (this.stopped) return true;
      // A conflict that survives a re-sync is no longer someone else being
      // quicker; it is a chain this client cannot get onto.
      if (this.attempt >= SAVE_STUCK_AFTER_ATTEMPTS) {
        this.reportStuck(sent, "conflict", result.message);
      }
      await this.sleep(this.backoffMs(this.attempt));
      return this.stopped;
    }
    // Network error, an answer we cannot read, or unauthorized: nothing is known
    // about the patches, so nothing local changes. Back off and try the same
    // batch again.
    this.activity.work("patch:save-retry");
    this.setState({
      status: "retrying",
      patches: sent,
      reason: result.status,
      message: result.message,
      attempt: this.attempt,
    });
    /*
     * `unauthorized` is left out on purpose: signing in again is a different
     * conversation, already had elsewhere by the account UI, and reporting it
     * here would say "saving is stuck" about something the user can simply fix.
     */
    if (
      result.status !== "unauthorized" &&
      this.attempt >= SAVE_STUCK_AFTER_ATTEMPTS
    ) {
      this.reportStuck(sent, result.status, result.message);
    }
    await this.sleep(this.backoffMs(this.attempt));
    return this.stopped;
  }

  /**
   * Say that a save is stuck — once per spell, not once per attempt.
   *
   * The retry loop runs for as long as the fault lasts, and `StatusStore` errors
   * are sticky until dismissed, so emitting on every attempt would stack a fresh
   * report every backoff. The latch is cleared on the next success, so a fault
   * that comes back is reported again.
   */
  private reportStuck(
    patches: PatchId[],
    reason: "conflict" | "network-error" | "unparseable-response",
    message: string,
  ): void {
    if (this.reportedStuck) return;
    this.reportedStuck = true;
    this.events.emit({
      type: "patch:save-stuck",
      patches,
      reason,
      message,
      attempt: this.attempt,
    });
  }

  private setState(state: SyncState): void {
    if (sameState(this.state, state)) {
      // Not news. A drain that concludes `in-sync` on every pass would otherwise
      // announce a change that did not happen, and a `useSyncExternalStore`
      // consumer would re-render for each one.
      return;
    }
    this.state = state;
    this.events.emit({ type: "patch:sync-state", state });
  }

  /**
   * Stop retrying.
   *
   * Checked after every await rather than only at the top: a retry loop that is
   * mid-backoff when the system is disposed would otherwise wake up and write to
   * a torn-down store — and in a test, after the test that created it finished.
   */
  dispose(): void {
    this.stopped = true;
  }
}
