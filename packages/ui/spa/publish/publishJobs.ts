import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import { randomUUID } from "../utils/randomUUID";
import type { StudioJobClient } from "./jobClient";
import {
  runJobToEnd,
  type JobPhase,
  type StudioJobResult,
} from "./runStudioJob";

/**
 * A Studio tab's publish jobs: the presses it made, and the job it builds.
 *
 * valbuild/home's docs/app-mode.md, "Publishing is a queued job", is the
 * design. A press is a REQUEST: content answers at once, and hands the tab a
 * job when the press started one. The tab builds it -- prepare, build, upload
 * -- and content verifies and seals it. Everything after the upload is
 * content's, so what the tab tracks from then on is the REQUEST, re-read on
 * every websocket nudge and on a slow poll, until it is Live or failed.
 *
 * A tab that is free and can build also asks for queued work: a press whose
 * own tab closed, or one queued behind the job that just finished. That is the
 * only way a queued request reaches a builder, so it is asked whenever a job
 * moves -- the nudge -- and once at the start.
 *
 * No React in here, so it runs under jest as it runs in the page; the hook is
 * `usePublishJobs`.
 */

/** A press this tab made, and where it is. */
export type TrackedPublish = {
  requestId: string;
  pressedAt: number;
  status: PublishRequestStatus;
  /**
   * When this tab handed its job to content. Set only for a request whose
   * job this tab ran; the wait after it is content's.
   */
  handedOffAt?: number;
  /**
   * Who builds it after the hand-off: this tab already did (`studio`), or CI
   * will, after content's push (`ci`, a connected project).
   */
  builtBy?: "studio" | "ci";
  /** When this tab first saw it settled. */
  settledAt?: number;
  /**
   * The job that carries it, once this tab knows: the one the press came
   * back with, or the one this tab ran and handed off. So the status bar can
   * tell this tab's own job from another editor's on the websocket.
   */
  jobId?: string;
  /**
   * The changes this press sent: what the gate checked when it was pressed
   * (`toPublish` in `createSystem`). Until the request fails they are on
   * their way or shipped, not waiting for a press -- a button that counted
   * them would offer to publish what is already publishing. See
   * `publishingPatchIds`.
   */
  patchIds?: readonly string[];
};

export type PublishJobsState = {
  /** This tab's presses, oldest first, until each is dismissed. */
  requests: readonly TrackedPublish[];
  /** The job this tab is building, and how far it has got. */
  running: { jobId: string; phase: JobPhase | null } | null;
  /**
   * Retries whose press has not been answered yet, by the new request id, and
   * the changes each sends: held from the click. See `tryAgain`.
   */
  retrying?: Readonly<Record<string, readonly string[]>>;
};

export type PublishJobs = {
  get(): PublishJobsState;
  subscribe(listener: () => void): () => void;
  /** A press was answered: track it, and build the job it came with. */
  track(pressed: {
    requestId: string;
    request: PublishRequestStatus;
    job: PublishTabJob | null;
    /** What the press sent; see `TrackedPublish.patchIds`. */
    patchIds?: readonly string[];
  }): void;
  /** A job moved: re-read what is not settled, and look for queued work. */
  nudge(): void;
  /**
   * Try again on a failed request: a new press, replacing it. `patchIds` is
   * what is pending at the press: a retry is a new job, and a job takes
   * everything pending, edits made since the failure included.
   */
  tryAgain(
    requestId: string,
    options?: { patchIds?: readonly string[] },
  ): Promise<ActionResult>;
  /** Discard a failed request's changes. */
  discard(requestId: string): Promise<ActionResult>;
  /** Stop showing a request that has settled. */
  dismiss(requestId: string): void;
  /** Ask for queued work once, and start the poll. */
  start(): void;
  stop(): void;
};

export type ActionResult =
  | {
      ok: true;
      /** Discard: these changes are held by a job in flight, and were kept. */
      stillHeld?: string[];
    }
  | { ok: false; message: string };

/** How often a request that has not settled is re-read without a nudge. */
export const POLL_MS = 5_000;

export const isSettled = (status: PublishRequestStatus): boolean =>
  status.kind === "live" ||
  status.kind === "failed" ||
  status.kind === "cancelled" ||
  status.kind === "nothing-to-publish";

/**
 * The changes this tab's presses sent, and that are not waiting for a press:
 * publishing, or published.
 *
 * A press stops holding the button once its job is content's (see
 * `waitingElsewhere` in `ValProvider`), but the changes it carries are not
 * committed until content seals the job, so until then they still read as
 * pending -- and a pending change is what lights Publish. Without this the
 * button went green at the hand-off, on the very change it was publishing.
 *
 * A request past its seal keeps its changes here too: Live, or failed with
 * only `re-run-build` left (committed, and CI's build of it failed). Its
 * changes are committed, but this tab hears that from `/stat`
 * (`appliedPatches`), and the request's own status can arrive first; dropping
 * them then lit Publish for the gap, over changes already published. A
 * request that failed before its seal, was cancelled, or had nothing to
 * publish gives its changes back: they are pending again, and Publish is how
 * to retry them.
 */
/** Committed: Live, or built by CI after the seal and failed there. */
const isSealed = (status: PublishRequestStatus): boolean =>
  status.kind === "live" ||
  (status.kind === "failed" && status.actions.includes("re-run-build"));

export function publishingPatchIds(
  state: PublishJobsState,
  /**
   * What content says a running publish holds, on any tab or device --
   * `publishingPatches` on `/stat` and the socket's `patches` message.
   * `undefined` where it does not say.
   *
   * Content is the authority: it is the only one that knows about a press on
   * another tab or device, or about this tab's own press once it has been
   * reloaded. This tab's own requests cover the moment between its press and
   * content's next answer, when Publish would otherwise light up again.
   */
  reported?: Iterable<string>,
  /**
   * When content said `reported`. A press of this tab's that failed before
   * its seal AFTER that gives its changes back over it: the job that held
   * them has ended, and `reported` is from while it ran. Without this,
   * Publish read "Publishing" beside the "Could not publish" toast until
   * content spoke again -- a `patches` message, which can be lost, or the
   * next `/stat`, which with a socket up is twenty minutes away. What content
   * says after the failure stands: another publish may have taken them since.
   */
  reportedAt?: number,
): ReadonlySet<string> {
  const givenBack = new Set<string>();
  if (reportedAt !== undefined) {
    for (const request of state.requests) {
      if (
        isSettled(request.status) &&
        !isSealed(request.status) &&
        (request.settledAt ?? -Infinity) > reportedAt
      ) {
        for (const id of request.patchIds ?? []) givenBack.add(id);
      }
    }
  }
  const ids = new Set<string>();
  for (const id of reported ?? []) {
    if (!givenBack.has(id)) ids.add(id);
  }
  for (const held of Object.values(state.retrying ?? {})) {
    for (const id of held) ids.add(id);
  }
  for (const request of state.requests) {
    if (isSettled(request.status) && !isSealed(request.status)) continue;
    for (const id of request.patchIds ?? []) ids.add(id);
  }
  return ids;
}

/**
 * The changes content says a running publish holds, kept until content says
 * they are pending again.
 *
 * Content stops listing a change the moment its publish ends. If it ended in
 * a seal, this Studio has yet to take that in: the patch store adopts the
 * applied list and the new base on its own schedule (`BaseAlignment` fetches
 * it), and until then the change still reads as unpublished. Releasing it with
 * content's list lit Publish for that fetch, over a change already published.
 *
 * So a change leaves this set only when content lists it as PENDING -- in the
 * chain and not applied -- which is a publish that failed, was cancelled or
 * was interrupted giving it back. One content reports applied, or no longer
 * lists at all (built into the base), stays held, and the store's own
 * committed / forgotten state takes over from there.
 *
 * `undefined` publishing is a content service that does not say: no news.
 */
export function heldByContent(
  previous: ReadonlySet<string>,
  report:
    | {
        publishingPatches?: readonly string[];
        patches?: readonly string[];
        appliedPatches?: readonly string[];
      }
    | undefined,
  /**
   * Whether this Studio's patch store still counts a change as unpublished.
   * Once it does not -- committed, or forgotten -- the store answers for it,
   * and a hold kept past that only grows: every publish would add its changes
   * for the life of the Studio.
   */
  unpublishedHere: (patchId: string) => boolean = () => true,
): ReadonlySet<string> {
  const applied = new Set(report?.appliedPatches ?? []);
  const pending = new Set(
    (report?.patches ?? []).filter((patchId) => !applied.has(patchId)),
  );
  const next = new Set(report?.publishingPatches ?? []);
  for (const patchId of previous) {
    if (next.has(patchId)) continue;
    // No news keeps what was held, as far as content is concerned.
    const releasedByContent =
      report?.publishingPatches !== undefined && pending.has(patchId);
    if (!releasedByContent && unpublishedHere(patchId)) next.add(patchId);
  }
  // The same set keeps its identity, so what reads it does not re-render.
  if (
    next.size === previous.size &&
    [...next].every((id) => previous.has(id))
  ) {
    return previous;
  }
  return next;
}

export function createPublishJobs(options: {
  client: StudioJobClient;
  tab: string;
  /** Build a job this tab holds: `runStudioJob`, here or in a builder tab. */
  build: (
    job: PublishTabJob,
    onPhase: (phase: JobPhase) => void,
  ) => Promise<StudioJobResult>;
  /**
   * Whether this tab asks for queued work now. Not where it cannot build,
   * unless a builder tab it opened is still waiting for a job: such a page
   * hands its own presses to that tab, and has no tab to hand anything to
   * once it has closed.
   */
  takesQueuedWork: () => boolean;
  /** A tracked request settled: Live, failed, cancelled, nothing to publish. */
  onSettled?: (request: TrackedPublish) => void;
  pollMs?: number;
  now?: () => number;
}): PublishJobs {
  const { client, tab } = options;
  const now = options.now ?? Date.now;
  let state: PublishJobsState = { requests: [], running: null };
  const listeners = new Set<() => void>();
  let poll: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  /** One refresh at a time; a nudge during one asks for another after it. */
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  /** Jobs this tab has run to the end of its part. See `takeQueuedWork`. */
  const ended = new Set<string>();
  /** The job a press started, when content answered it with one. */
  const jobOfRequest = new Map<string, string>();

  const set = (next: PublishJobsState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const update = (
    requestId: string,
    change: (request: TrackedPublish) => TrackedPublish,
  ) => {
    const before = state.requests.find((r) => r.requestId === requestId);
    if (before === undefined) return;
    const changed = change(before);
    const after =
      !isSettled(before.status) && isSettled(changed.status)
        ? { ...changed, settledAt: now() }
        : changed;
    set({
      ...state,
      requests: state.requests.map((r) =>
        r.requestId === requestId ? after : r,
      ),
    });
    if (!isSettled(before.status) && isSettled(after.status)) {
      options.onSettled?.(after);
    }
  };

  async function run(job: PublishTabJob) {
    if (state.running !== null || stopped) return;
    set({ ...state, running: { jobId: job.id, phase: null } });
    /*
     * The presses this job may carry: those open when it STARTS. Taken before
     * anything is awaited, because a status refresh during the build -- or the
     * one after it -- can settle one, Live or failed after the seal, and that
     * one is still this job's and still holds what the job took.
     */
    const open = new Set(
      state.requests
        .filter(
          (request) =>
            !isSettled(request.status) && request.handedOffAt === undefined,
        )
        .map((request) => request.requestId),
    );
    try {
      const result = await runJobToEnd({
        client,
        job,
        tab,
        run: () =>
          options.build(job, (phase) => {
            if (state.running?.jobId === job.id) {
              set({ ...state, running: { jobId: job.id, phase } });
            }
          }),
      });
      if (result.status === "handed-off") {
        const at = now();
        const builtBy = result.built ? "studio" : "ci";
        // Where each press is now, so one still queued behind this job is
        // not taken for one of its own.
        await refresh();
        set({
          ...state,
          requests: state.requests.map((request) => {
            if (!open.has(request.requestId) || !carries(job, request)) {
              return request;
            }
            // A press queued without a job holds what it sent; the job it
            // joined took everything pending, edits saved since included.
            // Only for a press that named what it sent.
            const held =
              request.patchIds !== undefined
                ? {
                    patchIds: [
                      ...new Set([...request.patchIds, ...job.patches]),
                    ],
                  }
                : {};
            // The hand-off itself only for one still waiting on content: one
            // that settled in the refresh already has its answer.
            return isSettled(request.status)
              ? { ...request, ...held }
              : {
                  ...request,
                  handedOffAt: at,
                  builtBy,
                  jobId: job.id,
                  ...held,
                };
          }),
        });
      }
    } finally {
      ended.add(job.id);
      set({ ...state, running: null });
    }
    await refresh();
    await takeQueuedWork();
  }

  /**
   * Whether a press is one this job carries. A press answered with a job is
   * that job's; one answered without is whichever job content gives its
   * changes to, which a status still `queued` is not.
   *
   * Content's status does not name that job, so what the press sent does: a
   * job that took at least one change it sent. Moving on from `queued` alone
   * is not enough -- a press another tab's job published goes Live too, and
   * this job, which took none of its changes, would widen it with its own:
   * held under a sealed press, so a failure here could never give them back.
   *
   * At least one, not all: what a press sends is captured before the publish
   * ahead of it is marked applied, so it can name a change that publish
   * already took, and the job it joined then takes the rest.
   */
  function carries(job: PublishTabJob, request: TrackedPublish): boolean {
    const known = jobOfRequest.get(request.requestId);
    if (known !== undefined) return known === job.id;
    if (request.status.kind === "queued") return false;
    if (request.patchIds === undefined) return true;
    const taken = new Set(job.patches);
    return request.patchIds.some((patchId) => taken.has(patchId));
  }

  async function takeQueuedWork() {
    if (!options.takesQueuedWork() || state.running !== null || stopped) return;
    const job = await client.next(tab).catch(() => null);
    /*
     * Not a job that already ended here: content can hand a tab back the job
     * it still leases to it, and one that ended lost or failed would only end
     * the same way again. Its lease lapses and a nudge brings the next one.
     */
    if (job !== null && job.step !== null && !ended.has(job.id)) await run(job);
  }

  async function refreshOnce() {
    const open = state.requests.filter((request) => !isSettled(request.status));
    await Promise.all(
      open.map(async ({ requestId }) => {
        const status = await client.requestStatus(requestId).catch(() => null);
        if (status !== null) update(requestId, (r) => ({ ...r, status }));
      }),
    );
  }

  function refresh(): Promise<void> {
    if (refreshing !== null) {
      refreshAgain = true;
      return refreshing;
    }
    /*
     * Cleared in the same step as the loop's last check. A `.finally` on the
     * promise ran a microtask later, and a refresh asked for in that gap set
     * `refreshAgain` after the loop had stopped looking and was handed a
     * promise for a read made before it asked -- the hand-off's "where is
     * each press now" got an answer from before the build.
     */
    refreshing = (async () => {
      try {
        do {
          refreshAgain = false;
          await refreshOnce();
        } while (refreshAgain);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function startPolling() {
    if (poll !== null || stopped) return;
    poll = setInterval(() => {
      if (state.requests.some((request) => !isSettled(request.status))) {
        void refresh();
      }
    }, options.pollMs ?? POLL_MS);
  }

  function track({
    requestId,
    request,
    job,
    patchIds,
  }: {
    requestId: string;
    request: PublishRequestStatus;
    job: PublishTabJob | null;
    patchIds?: readonly string[];
  }) {
    const at = now();
    /*
     * And the job's own list: a job takes everything pending, which can be
     * more than the gate checked -- a save that landed after it. Only for a
     * press that named what it sent; one that did not is not held.
     */
    const carried =
      patchIds === undefined
        ? []
        : [...new Set([...patchIds, ...(job?.patches ?? [])])];
    const tracked: TrackedPublish = {
      requestId,
      pressedAt: at,
      status: request,
      ...(isSettled(request) ? { settledAt: at } : {}),
      ...(job !== null ? { jobId: job.id } : {}),
      ...(carried.length > 0 ? { patchIds: carried } : {}),
    };
    const known = state.requests.some((r) => r.requestId === requestId);
    set({
      ...state,
      requests: known
        ? state.requests.map((r) => (r.requestId === requestId ? tracked : r))
        : [...state.requests, tracked],
    });
    if (job !== null) jobOfRequest.set(requestId, job.id);
    if (isSettled(request)) options.onSettled?.(tracked);
    if (job !== null && job.step !== null) void run(job);
  }

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    track,
    nudge: () => {
      void refresh();
      void takeQueuedWork();
    },
    tryAgain: async (requestId, retryOptions) => {
      const requestIdAgain = randomUUID();
      const replaced = state.requests.find((r) => r.requestId === requestId);
      // A retry sends the changes the failed press did, and whatever has
      // been saved since: the new job takes everything pending.
      const sent = [
        ...(replaced?.patchIds ?? []),
        ...(retryOptions?.patchIds ?? []),
      ];
      /*
       * Held from the click, not from content's answer: until it comes, the
       * failed press is settled and holds nothing, and Publish was offered
       * over the very changes being retried for that round trip.
       */
      set({
        ...state,
        retrying: { ...state.retrying, [requestIdAgain]: sent },
      });
      const releaseRetryHold = () => {
        const { [requestIdAgain]: _released, ...rest } = state.retrying ?? {};
        void _released;
        set({ ...state, retrying: rest });
      };
      try {
        const pressed = await client.tryAgain(requestIdAgain, tab);
        set({
          ...state,
          requests: state.requests.filter((r) => r.requestId !== requestId),
        });
        // Through `track`, so a press that settled at once is announced.
        track({
          requestId: requestIdAgain,
          request: pressed.request,
          job: pressed.job,
          ...(replaced?.patchIds !== undefined ||
          retryOptions?.patchIds !== undefined
            ? { patchIds: sent }
            : {}),
        });
        // `track` holds them now, as the new press's own.
        releaseRetryHold();
        return { ok: true };
      } catch (error) {
        releaseRetryHold();
        return { ok: false, message: messageOf(error) };
      }
    },
    discard: async (requestId) => {
      const request = state.requests.find((r) => r.requestId === requestId);
      if (request?.status.kind !== "failed") {
        return {
          ok: false,
          message: "Only a failed publish can be discarded.",
        };
      }
      try {
        const stillHeld = await client.discard(request.status.job);
        set({
          ...state,
          requests: state.requests.filter((r) => r.requestId !== requestId),
        });
        return stillHeld.length > 0 ? { ok: true, stillHeld } : { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    dismiss: (requestId) => {
      set({
        ...state,
        requests: state.requests.filter(
          (r) => r.requestId !== requestId || !isSettled(r.status),
        ),
      });
    },
    start: () => {
      stopped = false;
      startPolling();
      void takeQueuedWork();
    },
    stop: () => {
      stopped = true;
      if (poll !== null) clearInterval(poll);
      poll = null;
    },
  };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
