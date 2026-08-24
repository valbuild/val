import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { ParentRef, Patch } from "@valbuild/core/patch";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
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
}) => Promise<SaveResult>;

export type SaveResult =
  | { status: "saved"; newPatchIds: PatchId[]; parentRef: ParentRef }
  | { status: "conflict"; message: string }
  | {
      status: "rejected";
      message: string;
      errors?: Record<ModuleFilePath, string[]>;
    }
  | { status: "network-error"; message: string }
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
      reason: "conflict" | "network-error" | "unauthorized";
      message: string;
      attempt: number;
    };

/**
 * A permanent refusal, kept until someone acknowledges it.
 *
 * NOT a {@link SyncState}, which is where it started and which was wrong. The
 * queue state after a rejection is genuinely `in-sync` — the patches were
 * dropped, so nothing is pending — and the very next drain therefore overwrote
 * `rejected` with the truth, which meant the one outcome that destroys a user's
 * edit was also the one a UI could not reliably see. So the queue reports the
 * queue and this reports the failure, and neither can erase the other.
 *
 * Sticky on purpose: cleared by {@link PatchSync.clearRejection} and by nothing
 * else. A rejection that expires on its own is a rejection someone misses.
 */
export type SaveRejection = {
  patches: PatchId[];
  message: string;
  errors?: Record<ModuleFilePath, string[]>;
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
  private state: SyncState = { status: "in-sync" };
  private rejection: SaveRejection | null = null;
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

  currentState(): SyncState {
    return this.state;
  }

  /** The last permanent refusal, until it is acknowledged. */
  lastRejection(): SaveRejection | null {
    return this.rejection;
  }

  /** The caller has shown the user. Forget it. */
  clearRejection(): void {
    this.rejection = null;
  }

  /**
   * What the next write names as its parent.
   *
   * Computed, not stored — see {@link savedNotInStat}. Deliberately ignores the
   * LOCAL head: that includes patches the server has never seen, and naming one
   * of those as a parent is a guaranteed 409.
   */
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
      const patchIds = records.map((record) => record.patchId);
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
      this.activity.work("patch:save", undefined, records.length);
      this.events.emit({ type: "patch:save", patches: patchIds, parentRef });
      const result = await save({
        patches: records.map((record) => ({
          path: record.moduleFilePath,
          patchId: record.patchId,
          patch: record.patch,
        })),
        parentRef,
        sessionId: this.sessionId,
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
      this.savedNotInStat.push(...result.newPatchIds);
      // The ids the SERVER named, not the ids we sent — see `markSaved`.
      this.patchStore.markSaved(result.newPatchIds);
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
      // Permanently bad, so this is the one branch that destroys local state.
      // The patches are dropped and the source rebuilt without them, because the
      // alternative is a user staring at an edit that will never exist.
      this.attempt = 0;
      this.patchStore.drop(sent);
      this.rejection = {
        patches: sent,
        message: result.message,
        errors: result.errors,
      };
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
      await this.sleep(this.backoffMs(this.attempt));
      return this.stopped;
    }
    // Network error or unauthorized: nothing is known about the patches, so
    // nothing local changes. Back off and try the same batch again.
    this.activity.work("patch:save-retry");
    this.setState({
      status: "retrying",
      patches: sent,
      reason: result.status,
      message: result.message,
      attempt: this.attempt,
    });
    await this.sleep(this.backoffMs(this.attempt));
    return this.stopped;
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
