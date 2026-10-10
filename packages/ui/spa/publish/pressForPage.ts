import type {
  DependencyChange,
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { PressAs, PublishResult } from "../stores/PublishSeam";
import { describePublishRefusal } from "../utils/describePublishRefusal";
import { forgetHandoffIntent, type HandoffIntent } from "./handoff";
import type { StudioJobClient } from "./jobClient";
import { browserStorage, readKeyed, writeKeyed } from "./browserStorage";
import { isTransientPublishError, StudioPublishError } from "./publishClient";
import type { SiteUpdateOutcome } from "./runSiteUpdate";
import { isSettled } from "./publishJobs";
import { withinDeadline } from "./withinDeadline";

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
  /** The proposal it merges: see `HandoffIntent`. */
  merge?: string;
};

export type PressForPageOutcome =
  | PressedForPage
  /**
   * Nothing was requested: `message` for the editor, `details` for a report.
   *
   * `durable`: an answer that the same press would get again -- the gate
   * refused, content refused -- which a tab opened again may show as it is.
   * Not durable: it gave up on a press that got no answer, which content may
   * have taken after all, so a tab opened again must ask rather than say so.
   */
  | {
      kind: "not-pressed";
      message: string;
      details?: string;
      durable: boolean;
      /** The gate found nothing pending. */
      nothingToPublish?: true;
    };

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
 *
 * Of the editor's own patch group, where the project has groups (`scope`,
 * `system.patchGroup()`): that is what the press publishes. Another editor's
 * saved change after this one's unsaved edit would otherwise be the one
 * named, already on the server, and the tab would press without the edit.
 * `null` scope: the whole chain.
 */
export function newestUnpublished(
  store: ChainOf,
  scope: readonly string[] | null,
): string | null {
  const inScope = scope === null ? null : new Set(scope);
  const ids = store
    .allRecords()
    .map((record) => record.patchId)
    .filter((patchId) => inScope === null || inScope.has(patchId));
  const pending = store.pendingAmong(ids);
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (id !== undefined && pending.has(id)) return id;
  }
  return null;
}

/** Where the server says a change is: see `PatchStore.serverStateOf`. */
export type ChangeOnServer = "shipped" | "pending" | "absent" | "unknown";

/** Ask `store` where `patchId` is; `unknown` without a store to ask. */
export function askServerAbout(
  store: { serverStateOf(patchId: string): Promise<ChangeOnServer> } | null,
  patchId: string,
): Promise<ChangeOnServer> {
  return store === null
    ? Promise.resolve("unknown")
    : store.serverStateOf(patchId);
}

/** How often the tab asks the server about a change it has not seen arrive. */
export const CHANGE_ASK_EVERY_MS = 3_000;

/**
 * Wait for the page's last change: until it is in this tab's chain, or the
 * server says it has SHIPPED -- another publish took it before this tab
 * loaded, and a fresh tab's chain never lists a shipped patch, so without
 * asking it would wait out the deadline over a change already live.
 *
 * `inChain` is polled as often as {@link whenReady} does; the server is asked
 * every `askEveryMs`, since that is a request.
 */
export async function waitForChange(options: {
  inChain: () => boolean;
  serverState: () => Promise<ChangeOnServer>;
  everyMs?: number;
  askEveryMs?: number;
  timeoutMs?: number;
}): Promise<"arrived" | "shipped" | "timed-out"> {
  const everyMs = options.everyMs ?? READY_EVERY_MS;
  const askEveryMs = options.askEveryMs ?? CHANGE_ASK_EVERY_MS;
  const timeoutMs = options.timeoutMs ?? CHANGE_TIMEOUT_MS;
  const startedAt = Date.now();
  let askedAt = -Infinity;
  for (;;) {
    if (options.inChain()) return "arrived";
    if (Date.now() - askedAt >= askEveryMs) {
      askedAt = Date.now();
      /*
       * Bounded by what is left of the deadline: a request that never
       * answers would otherwise hold the wait past it, at the very screen
       * this exists to get past.
       */
      const left = Math.max(0, timeoutMs - (Date.now() - startedAt));
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const said = await Promise.race<ChangeOnServer>([
        options.serverState(),
        new Promise<ChangeOnServer>((resolve) => {
          deadline = setTimeout(() => resolve("unknown"), left);
        }),
      ]).finally(() => clearTimeout(deadline));
      if (said === "shipped") return "shipped";
      if (options.inChain()) return "arrived";
    }
    if (Date.now() - startedAt >= timeoutMs) return "timed-out";
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/**
 * Is the change `after` names in this tab's chain, saved? One that has
 * shipped is not in it: see {@link waitForChange}.
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
 * A merge runs no gate either: it ships the proposal's last save, and content
 * checks whether it may (the merge checks).
 */
export async function pressForPage(options: {
  intent: PressIntent;
  publish: (pressAs: PressAs) => Promise<PublishResult>;
  client: Pick<StudioJobClient, "tryAgain" | "pressMerge" | "requestStatus">;
  chain: () => string[];
  /** See {@link PRESS_RETRY_MS}. */
  retryMs?: readonly number[];
  /** See {@link withinDeadline}. */
  answerWithinMs?: number;
}): Promise<PressForPageOutcome> {
  const { intent } = options;
  const retryMs = options.retryMs ?? PRESS_RETRY_MS;
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const pressAs: PressAs = { requestId: intent.requestId, tab: intent.tab };
  const merge = intent.merge;
  if (intent.kind === "try-again" || merge !== undefined) {
    const replaces = intent.kind === "try-again" ? intent.replaces : null;
    /*
     * A merge sends nothing of the page's chain: what it publishes is the
     * proposal's last save.
     */
    const patchIds = () => (merge !== undefined ? [] : options.chain());
    const merging = merge !== undefined ? { merge } : {};
    const pressDirectly = () =>
      merge !== undefined
        ? options.client.pressMerge(merge, intent.requestId, intent.tab)
        : options.client.tryAgain(intent.requestId, intent.tab);
    try {
      let attempt = 0;
      const tryAgain = async (): Promise<
        Awaited<ReturnType<StudioJobClient["tryAgain"]>>
      > => {
        try {
          return await withinDeadline(pressDirectly(), options.answerWithinMs);
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
        patchIds: patchIds(),
        replaces,
        ...merging,
      };
    } catch (error) {
      /*
       * No answer is not a no: content may have made the request and lost
       * only the reply, as with a press. It says whether it did.
       */
      const landed = isTransientPublishError(error)
        ? await pressedAlready({
            client: options.client,
            requestId: intent.requestId,
            retryMs,
            ...(options.answerWithinMs !== undefined
              ? { answerWithinMs: options.answerWithinMs }
              : {}),
          })
        : null;
      if (landed !== null) {
        return {
          kind: "pressed",
          requestId: intent.requestId,
          request: landed,
          job: null,
          patchIds: patchIds(),
          replaces,
          ...merging,
        };
      }
      const details = error instanceof Error ? error.message : String(error);
      /*
       * A merge content refused is an answer meant for the editor: a merge
       * check said no, or the proposal was saved since. Said as it is.
       */
      if (merge !== undefined && !isTransientPublishError(error)) {
        return { kind: "not-pressed", message: details, durable: true };
      }
      return {
        kind: "not-pressed",
        message:
          merge !== undefined
            ? "The publish could not be started. Publish again to retry."
            : "The publish could not be started again. Publish again to retry.",
        details,
        durable: !isTransientPublishError(error),
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
  let unanswered = false;
  for (const wait of retryMs) {
    if (result.status !== "failed" || !result.retryable) break;
    unanswered = true;
    await pause(wait);
    result = await options.publish(pressAs);
  }
  /*
   * A press with no answer may still have reached content, and each retry
   * runs the whole gate again -- so an edit that landed in the pause can
   * refuse the retry before it gets there, and a press that did land would
   * be called "not pressed" and left behind. Content says whether it did.
   */
  if (unanswered && result.status !== "requested") {
    const landed = await pressedAlready({
      client: options.client,
      requestId: intent.requestId,
      retryMs,
      ...(options.answerWithinMs !== undefined
        ? { answerWithinMs: options.answerWithinMs }
        : {}),
    });
    if (landed !== null) {
      return {
        kind: "pressed",
        requestId: intent.requestId,
        request: landed,
        job: null,
        patchIds: options.chain(),
        replaces: null,
      };
    }
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
      return {
        kind: "not-pressed",
        message: "There was nothing to publish.",
        durable: true,
        nothingToPublish: true,
      };
    case "refused": {
      const said = describePublishRefusal(result);
      return {
        kind: "not-pressed",
        message: said.message,
        ...(said.details !== undefined ? { details: said.details } : {}),
        // The rest are about this moment: a save, an edit, a running publish.
        durable: result.reason === "validation-errors",
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
        durable: !result.retryable,
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
        durable: true,
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
 * Where a press already made is, followed until this tab has a job to build or
 * the request has settled.
 *
 * For a press this tab made that was queued, and for one it finds already
 * made when it opens again (a reload, the back button, the URL reopened):
 * that tab must show the publish, not make it a second time.
 *
 * Each round also asks content for work, as the page's tab, because that is
 * how a job comes back to a tab: a queued request starts one when its turn
 * comes, and a job whose tab went away mid-build -- the tab that was reloaded
 * -- is put back in the queue once its lease lapses, which content checks
 * when a tab asks. Asking never takes a job another live tab holds.
 *
 * No deadline of its own: every state a request can be in moves on without
 * this tab -- leases lapse, content reconciles a seal -- so the wait is on
 * something that will happen. `stopped()` ends it early.
 */
export async function followRequest(options: {
  client: Pick<StudioJobClient, "next" | "requestStatus">;
  requestId: string;
  tab: string;
  stopped: () => boolean;
  /** A job leased while following that is not this request's: still to run. */
  otherJob: (job: PublishTabJob) => void;
  /**
   * How to ask for the job, in place of `client.next`: a merge's tab is at
   * the proposal's address, which may not ask for queued work, and presses
   * its merge again instead -- which starts it once its turn has come, and
   * hands it nothing else.
   */
  claim?: () => Promise<PublishTabJob | null>;
  everyMs?: number;
  /** See {@link withinDeadline}. */
  answerWithinMs?: number;
}): Promise<
  | { kind: "job"; job: PublishTabJob }
  | { kind: "settled"; request: PublishRequestStatus }
  | { kind: "stopped" }
> {
  const everyMs = options.everyMs ?? QUEUED_EVERY_MS;
  for (;;) {
    if (options.stopped()) return { kind: "stopped" };
    const request = await withinDeadline(
      options.client.requestStatus(options.requestId),
      options.answerWithinMs,
    ).catch(() => null);
    if (options.stopped()) return { kind: "stopped" };
    if (request !== null && isSettled(request)) {
      return { kind: "settled", request };
    }
    const job = await withinDeadline(
      options.claim?.() ?? options.client.next(options.tab),
      options.answerWithinMs,
    ).catch(() => null);
    if (options.stopped()) return { kind: "stopped" };
    if (job !== null && job.step !== null) {
      /*
       * Asking for status and asking for work are two calls, and the request
       * can settle between them -- then the job leased is another request's
       * (content starts one for whatever is queued): this tab's to run, but
       * not as this press's, which is over. A request content could not be
       * asked about again is taken to be in the job, as before the check.
       */
      const after = await withinDeadline(
        options.client.requestStatus(options.requestId),
        options.answerWithinMs,
      ).catch(() => null);
      if (options.stopped()) return { kind: "stopped" };
      if (after !== null && isSettled(after)) {
        options.otherJob(job);
        return { kind: "settled", request: after };
      }
      return { kind: "job", job };
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/**
 * Has the press this tab is for been made already? Asked before anything
 * else, so a tab opened again shows the publish rather than making it again.
 *
 * `null`: content has never heard of it, so it is this tab's to make. A
 * request content could not be asked about is asked again; if it still
 * cannot be, the press goes ahead, which is safe -- content's press is
 * idempotent on the request id, so a press already made is not made twice.
 */
export async function pressedAlready(options: {
  client: Pick<StudioJobClient, "requestStatus">;
  requestId: string;
  retryMs?: readonly number[];
  /** See {@link withinDeadline}. */
  answerWithinMs?: number;
}): Promise<PublishRequestStatus | null> {
  const retryMs = options.retryMs ?? PRESS_RETRY_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withinDeadline(
        options.client.requestStatus(options.requestId),
        options.answerWithinMs,
      );
    } catch (error) {
      if (error instanceof StudioPublishError && error.statusCode === 404) {
        return null;
      }
      const wait = retryMs[attempt];
      if (wait === undefined || !isTransientPublishError(error)) return null;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** What a settled request means to the person looking at the tab. */
export function settledMessage(
  request: PublishRequestStatus,
): { live: true } | { live: false; message: string } {
  switch (request.kind) {
    case "live":
      return { live: true };
    case "failed":
      return { live: false, message: request.message };
    case "cancelled":
      return { live: false, message: "This publish was cancelled." };
    case "nothing-to-publish":
      return { live: false, message: "There was nothing to publish." };
    case "queued":
    case "publishing":
      return {
        live: false,
        message: "This publish has not finished yet.",
      };
  }
}

/**
 * What a tab remembers of its own ending, by hand-off id, where content has
 * nothing to ask: a press the gate refused (nothing was requested), and an
 * update (which is not a request). Opened again -- reloaded, gone back to,
 * the URL reopened -- the tab shows this rather than doing it again.
 *
 * In `localStorage`, so it reaches a reopened URL in another tab too, and
 * through `try`: storage can be off, full, or throw in a private window, and
 * then the tab simply does not remember.
 */
export type RememberedEnding =
  | { kind: "not-pressed"; message: string; details?: string }
  | { kind: "update"; outcome: SiteUpdateOutcome }
  /**
   * Another publish took the editor's change before this tab could press,
   * and there was nothing left to: Live, with no request of this tab's for
   * content to answer about. Remembered, or a tab opened again would find
   * no request, press, and publish whatever is pending by then.
   */
  | { kind: "shipped-elsewhere" };

/** One key per hand-off: see `writeKeyed`. */
const ENDING_PREFIX = "val-publish-handoff-ending:";
/** A week: long past any reload, and the list cannot grow without bound. */
const ENDING_KEEP_MS = 7 * 24 * 60 * 60_000;

function isEnding(value: unknown): value is RememberedEnding {
  if (typeof value !== "object" || value === null || !("kind" in value))
    return false;
  if (value.kind === "not-pressed") {
    return (
      "message" in value &&
      typeof value.message === "string" &&
      (!("details" in value) ||
        value.details === undefined ||
        typeof value.details === "string")
    );
  }
  if (value.kind === "shipped-elsewhere") return true;
  return (
    value.kind === "update" &&
    "outcome" in value &&
    isUpdateOutcome(value.outcome)
  );
}

/* Every arm, in full: storage is the origin's, and anything may be there. */
function isUpdateOutcome(value: unknown): value is SiteUpdateOutcome {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }
  const text = (key: string) =>
    key in value && typeof Reflect.get(value, key) === "string";
  switch (value.status) {
    case "updated":
      return (
        "changes" in value &&
        Array.isArray(value.changes) &&
        value.changes.every(isDependencyChange)
      );
    case "current":
      return true;
    case "unavailable":
      return text("message");
    case "failed":
      // Remembered without the deploy's record: see `rememberEnding`.
      return (
        text("message") &&
        text("details") &&
        "deploy" in value &&
        value.deploy === null
      );
    default:
      return false;
  }
}

function isDependencyChange(value: unknown): value is DependencyChange {
  if (typeof value !== "object" || value === null) return false;
  const field = (key: string): unknown =>
    key in value ? Reflect.get(value, key) : undefined;
  const version = (key: string) => {
    const at = field(key);
    return at === null || typeof at === "string";
  };
  const section = field("section");
  return (
    typeof field("name") === "string" &&
    (section === "dependencies" || section === "devDependencies") &&
    version("from") &&
    version("to")
  );
}

export function rememberEnding(
  id: string,
  ending: RememberedEnding,
  storage: Storage | null = browserStorage(),
  now: number = Date.now(),
): void {
  if (storage === null) return;
  // The deploy's own record stays out: it is large, and the page shows words.
  const stored: RememberedEnding =
    ending.kind === "update" && ending.outcome.status === "failed"
      ? { kind: "update", outcome: { ...ending.outcome, deploy: null } }
      : ending;
  const written = writeKeyed(storage, ENDING_PREFIX, id, stored, {
    now,
    keepMs: ENDING_KEEP_MS,
  });
  /*
   * Storage refused the ending (full, most likely): then the intent goes
   * instead. Left behind, a tab opened again within the hour would find no
   * ending and no request -- an update, or a press another publish made
   * unnecessary, has none -- and run it a second time. Removing asks storage
   * for nothing new, so it works where writing did not.
   */
  if (!written) forgetHandoffIntent(id, storage);
}

export function rememberedEnding(
  id: string,
  storage: Storage | null = browserStorage(),
): RememberedEnding | null {
  if (storage === null) return null;
  const entry = readKeyed(storage, ENDING_PREFIX, id);
  return entry !== null && isEnding(entry.value) ? entry.value : null;
}
