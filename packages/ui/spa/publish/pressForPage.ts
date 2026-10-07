import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { PressAs, PublishResult } from "../stores/PublishSeam";
import { describePublishRefusal } from "../utils/describePublishRefusal";
import type { HandoffIntent } from "./handoff";
import type { StudioJobClient } from "./jobClient";
import { isTransientPublishError } from "./publishClient";
import { isSettled } from "./publishJobs";

/**
 * The press a builder tab makes for the page that opened it.
 *
 * The page cannot make it: on an iPhone the builder takes the screen at the
 * tap and iOS pauses the page behind it, so the page's gate, its press and its
 * answer to the tab's `ready` all wait for the editor to go back -- and the tab
 * waited at "Starting the publish" for them. See `handoff.ts`. So the tab runs
 * the same gate the page would have (`system.publish`, as `pressAs`), and
 * content's press is the page's: its request id, and its tab, so the job is
 * leased to the tab content already expects.
 *
 * No React in here; `HandoffPublishTab` is what calls it.
 */

/** How often a tab asks whether its project has loaded, and for how long. */
export const READY_EVERY_MS = 200;
export const READY_TIMEOUT_MS = 90_000;
/**
 * How long the tab waits for the page's last change to reach the server.
 *
 * Longer than the load: the change is on its way from a page an iPhone may
 * have paused, and it arrives once the page runs again. Waiting costs nothing
 * -- nothing is pressed until it is there -- while giving up throws away a
 * publish that would have gone through.
 */
export const CHANGE_TIMEOUT_MS = 5 * 60_000;
/**
 * The press, again, after a failure that was not an answer (a network error,
 * a 5xx): content's press is idempotent on the request id, so a second one is
 * the same press. A refusal -- validation, nothing to publish -- is an answer,
 * and is never pressed again.
 */
export const PRESS_RETRY_MS: readonly number[] = [1_000, 3_000, 9_000];

/** The intents a tab presses for: everything but an update. */
export type PressIntent = Exclude<HandoffIntent, { kind: "update" }>;
/** How often a queued press asks for its job. */
export const QUEUED_EVERY_MS = 3_000;

export type PressedForPage = {
  kind: "pressed";
  requestId: string;
  request: PublishRequestStatus;
  /** The job the press started, for this tab to build. */
  job: PublishTabJob | null;
  /** What the gate checked: see `TrackedPublish.patchIds`. */
  patchIds: string[];
  /** For a try again: the failed request it replaces. */
  replaces: string | null;
};

export type PressForPageOutcome =
  | PressedForPage
  /** Nothing was requested: `message` for the editor, `details` for a report. */
  | { kind: "not-pressed"; message: string; details?: string };

/** The message for a project that never finished loading in the tab. */
export const NOT_LOADED_MESSAGE =
  "The Studio could not load your changes here, so nothing was published. Open the Studio and publish again.";
/** The message for a last change that never reached the server. */
export const CHANGE_NOT_SAVED_MESSAGE =
  "Your last change has not reached Val yet, so nothing was published. Go back to the page you were editing so it can save, then publish again.";

/** What a page knows about its changes: enough to name its newest one. */
type ChainOf = {
  allRecords(): readonly { patchId: string }[];
  pendingAmong(patchIds: Iterable<string>): Set<string>;
};

/**
 * The newest change a page has not published, or `null`: what a builder tab
 * must see on the server before it presses (see `HandoffIntent`). Saved or
 * not -- one made just before the tap usually is not.
 */
export function newestUnpublished(store: ChainOf): string | null {
  const ids = store.allRecords().map((record) => record.patchId);
  const pending = store.pendingAmong(ids);
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (id !== undefined && pending.has(id)) return id;
  }
  return null;
}

/**
 * Has the server got the change `after` names, as this tab sees it? Either it
 * is in the chain, saved -- or it has shipped already, which is when another
 * publish took it.
 */
export function hasChange(
  store: ChainOf & { isPending(patchId: string): boolean },
  after: string | null,
): boolean {
  if (after === null) return true;
  const inChain = store.allRecords().some((record) => record.patchId === after);
  return inChain && !store.isPending(after);
}

/**
 * Resolves `true` once `ready()` holds, or `false` after `timeoutMs`.
 *
 * Polled rather than subscribed: what it waits for is two stores (the host's
 * intake and the patch chain), each with its own events, and a tab that exists
 * to press once can afford to ask five times a second.
 */
export function whenReady(
  ready: () => boolean,
  options: { everyMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const everyMs = options.everyMs ?? READY_EVERY_MS;
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (ready()) return resolve(true);
      if (Date.now() - startedAt >= timeoutMs) return resolve(false);
      setTimeout(check, everyMs);
    };
    check();
  });
}

/**
 * Press for the page, as `intent` says.
 *
 * `publish` is the gate and the press -- `system.publish` with `request` and
 * `pressAs` -- and `chain` what is pending, for a try again, which runs no gate.
 */
export async function pressForPage(options: {
  intent: PressIntent;
  publish: (pressAs: PressAs) => Promise<PublishResult>;
  client: Pick<StudioJobClient, "tryAgain">;
  chain: () => string[];
  /** See {@link PRESS_RETRY_MS}. */
  retryMs?: readonly number[];
}): Promise<PressForPageOutcome> {
  const { intent } = options;
  const retryMs = options.retryMs ?? PRESS_RETRY_MS;
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const pressAs: PressAs = { requestId: intent.requestId, tab: intent.tab };
  if (intent.kind === "try-again") {
    try {
      let attempt = 0;
      const tryAgain = async (): Promise<
        Awaited<ReturnType<StudioJobClient["tryAgain"]>>
      > => {
        try {
          return await options.client.tryAgain(intent.requestId, intent.tab);
        } catch (error) {
          const wait = retryMs[attempt++];
          if (wait === undefined || !isTransientPublishError(error))
            throw error;
          await pause(wait);
          return tryAgain();
        }
      };
      const pressed = await tryAgain();
      return {
        kind: "pressed",
        requestId: intent.requestId,
        request: pressed.request,
        job: pressed.job,
        patchIds: options.chain(),
        replaces: intent.replaces,
      };
    } catch (error) {
      return {
        kind: "not-pressed",
        message:
          "The publish could not be started again. Publish again to retry.",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }
  /*
   * One retry for `chain-moved`, as the page's own press has: an edit that
   * landed while the gate ran is not a failure anyone can act on.
   */
  let result = await options.publish(pressAs);
  if (result.status === "refused" && result.reason === "chain-moved") {
    result = await options.publish(pressAs);
  }
  /*
   * A press that failed without an answer -- `retryable` is the seam saying
   * so -- is pressed again: the same request id, so the same press.
   */
  for (const wait of retryMs) {
    if (result.status !== "failed" || !result.retryable) break;
    await pause(wait);
    result = await options.publish(pressAs);
  }
  switch (result.status) {
    case "requested":
      return {
        kind: "pressed",
        requestId: result.requestId,
        request: result.request,
        job: result.job,
        patchIds: result.patchIds,
        replaces: null,
      };
    case "nothing-to-publish":
      return { kind: "not-pressed", message: "There was nothing to publish." };
    case "refused": {
      const said = describePublishRefusal(result);
      return {
        kind: "not-pressed",
        message: said.message,
        ...(said.details !== undefined ? { details: said.details } : {}),
      };
    }
    case "failed":
      return {
        kind: "not-pressed",
        message: "Could not publish. Nothing on the live site changed.",
        details: result.patchErrors
          ? Object.entries(result.patchErrors)
              .map(([patchId, message]) => `${patchId}: ${message}`)
              .join("\n")
          : result.message,
      };
    case "published":
      /*
       * A commit rather than a request: a project that does not publish as
       * jobs, which no page hands a press to. Said rather than built, because
       * this tab only knows how to build a job.
       */
      return {
        kind: "not-pressed",
        message:
          "This project publishes without a builder tab. Open the Studio to see the publish.",
      };
  }
}

/** Does this press leave the tab something to build, now or later? */
export function pressBuilds(pressed: PressedForPage): boolean {
  return (
    (pressed.job !== null && pressed.job.step !== null) ||
    pressed.request.kind === "queued"
  );
}

/**
 * What the tab says for a press that left it nothing to build -- the same
 * sentences the page used to cancel the tab with.
 */
export function nothingToBuildMessage(request: PublishRequestStatus): string {
  return request.kind === "publishing"
    ? "Your changes are publishing with the publish before them."
    : "There was nothing to publish.";
}

/**
 * A queued press's job, when its turn comes.
 *
 * On a page that could build, the page's own job runner asks content for
 * queued work. This tab is the page's runner now -- the page may be paused --
 * so it asks, as the page's tab. Content starts a job for every queued
 * request at once, so the job may carry other presses than this one.
 *
 * Ends with the job, or with the request's status once it is no longer
 * queued without one: another tab's job took it, or it settled.
 * `stopped()` ends it early -- a job arrived over the channel instead.
 */
export async function waitForQueuedJob(options: {
  client: Pick<StudioJobClient, "next" | "requestStatus">;
  requestId: string;
  tab: string;
  stopped: () => boolean;
  everyMs?: number;
}): Promise<
  | { kind: "job"; job: PublishTabJob }
  | { kind: "moved"; request: PublishRequestStatus }
  | { kind: "stopped" }
> {
  const everyMs = options.everyMs ?? QUEUED_EVERY_MS;
  for (;;) {
    if (options.stopped()) return { kind: "stopped" };
    const job = await options.client.next(options.tab).catch(() => null);
    if (options.stopped()) return { kind: "stopped" };
    if (job !== null && job.step !== null) return { kind: "job", job };
    const request = await options.client
      .requestStatus(options.requestId)
      .catch(() => null);
    if (
      request !== null &&
      (isSettled(request) || request.kind === "publishing")
    ) {
      return { kind: "moved", request };
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
