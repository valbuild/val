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
};

export type PublishJobsState = {
  /** This tab's presses, oldest first, until each is dismissed. */
  requests: readonly TrackedPublish[];
  /** The job this tab is building, and how far it has got. */
  running: { jobId: string; phase: JobPhase | null } | null;
};

export type PublishJobs = {
  get(): PublishJobsState;
  subscribe(listener: () => void): () => void;
  /** A press was answered: track it, and build the job it came with. */
  track(pressed: {
    requestId: string;
    request: PublishRequestStatus;
    job: PublishTabJob | null;
  }): void;
  /** A job moved: re-read what is not settled, and look for queued work. */
  nudge(): void;
  /** Try again on a failed request: a new press, replacing it. */
  tryAgain(requestId: string): Promise<ActionResult>;
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
          requests: state.requests.map((request) =>
            isSettled(request.status) ||
            request.handedOffAt !== undefined ||
            !carries(job.id, request)
              ? request
              : { ...request, handedOffAt: at, builtBy },
          ),
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
   */
  function carries(jobId: string, request: TrackedPublish): boolean {
    const known = jobOfRequest.get(request.requestId);
    if (known !== undefined) return known === jobId;
    return request.status.kind !== "queued";
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
    refreshing = (async () => {
      do {
        refreshAgain = false;
        await refreshOnce();
      } while (refreshAgain);
    })().finally(() => {
      refreshing = null;
    });
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
  }: {
    requestId: string;
    request: PublishRequestStatus;
    job: PublishTabJob | null;
  }) {
    const at = now();
    const tracked: TrackedPublish = {
      requestId,
      pressedAt: at,
      status: request,
      ...(isSettled(request) ? { settledAt: at } : {}),
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
    tryAgain: async (requestId) => {
      const requestIdAgain = randomUUID();
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
        });
        return { ok: true };
      } catch (error) {
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
