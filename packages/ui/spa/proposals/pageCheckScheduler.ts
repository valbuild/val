/**
 * When the page check runs (`pageCheck.ts`): the one part of the background
 * checks that costs model tokens, so the one that waits.
 *
 * - After a code change it waits for the assistant's turn to end, or for
 *   {@link PAGE_CHECK_QUIET_MS} without another change, whichever comes
 *   first: a run of edits is checked once, after it.
 * - `verify` from the assistant starts one at once, changed or not.
 * - The timer survives turns: a turn ending or the person writing does not
 *   cancel it. Only another change restarts it.
 * - One runs at a time. Asked for while one runs, it runs once more after,
 *   with what it was asked for -- never twice more.
 * - At most {@link PAGE_CHECKS_PER_MESSAGE} per message from the person,
 *   however they are started: a mechanical stop, so nothing the checks and
 *   the assistant do between them can spend tokens without end. Only the
 *   person writing again gives it more.
 */
export const PAGE_CHECK_QUIET_MS = 30_000;
export const PAGE_CHECKS_PER_MESSAGE = 3;

/** Why a page check was started. */
export type PageCheckReason = "turn-ended" | "quiet" | "verify" | "message";

/** A page check to start: why, and what the assistant asked it to look at. */
export type PageCheckRequest = {
  reason: PageCheckReason;
  /** From `verify` or `message_verifier`, in the assistant's words. */
  focus: string | null;
};

/** What asking for a check came to. */
export type PageCheckAsked =
  | { status: "started" }
  /** One runs: this one runs after it. */
  | { status: "queued" }
  /** None left until the person writes again. */
  | { status: "limited" }
  /** None can run here: no preview open, or no model. Not counted. */
  | { status: "not-here" };

/** Runs `run` after `ms`; what it answers cancels it. */
export type PageCheckTimer = (run: () => void, ms: number) => () => void;

const realTimer: PageCheckTimer = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export type PageCheckScheduler = {
  /** The proposal's code changed: check it once the changes stop. */
  codeChanged: () => void;
  /** The assistant's turn ended: check a change not checked yet, now. */
  turnEnded: () => void;
  /** Check now, whatever changed: `verify` or `message_verifier`. */
  checkNow: (request: PageCheckRequest) => PageCheckAsked;
  /** The person wrote: the checks it may run start over. */
  personWrote: () => void;
  /** The running check ended, however it ended. */
  finished: () => void;
  /** Checks left until the person writes again. */
  left: () => number;
  /** Forget the timer: the chat or proposal was left. */
  dispose: () => void;
};

export function createPageCheckScheduler(
  /**
   * Start a check; `false` when none can run here (no preview, no model):
   * then it is not counted, and nothing runs.
   */
  start: (request: PageCheckRequest) => boolean,
  options: {
    timer?: PageCheckTimer;
    quietMs?: number;
    perMessage?: number;
  } = {},
): PageCheckScheduler {
  const after = options.timer ?? realTimer;
  const quietMs = options.quietMs ?? PAGE_CHECK_QUIET_MS;
  const perMessage = options.perMessage ?? PAGE_CHECKS_PER_MESSAGE;
  let left = perMessage;
  /** A change no check has been asked for since. */
  let unchecked = false;
  let cancelTimer: (() => void) | null = null;
  let running = false;
  let next: PageCheckRequest | null = null;

  const stopTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const ask = (request: PageCheckRequest): PageCheckAsked => {
    stopTimer();
    unchecked = false;
    if (running) {
      // One more after this one, with the latest focus that was asked.
      next =
        next === null
          ? request
          : { reason: request.reason, focus: request.focus ?? next.focus };
      return { status: "queued" };
    }
    if (left <= 0) return { status: "limited" };
    left--;
    running = true;
    if (!start(request)) {
      left++;
      running = false;
      return { status: "not-here" };
    }
    return { status: "started" };
  };

  return {
    codeChanged: () => {
      unchecked = true;
      stopTimer();
      cancelTimer = after(() => {
        cancelTimer = null;
        ask({ reason: "quiet", focus: null });
      }, quietMs);
    },
    turnEnded: () => {
      if (unchecked) ask({ reason: "turn-ended", focus: null });
    },
    checkNow: (request) => ask(request),
    personWrote: () => {
      left = perMessage;
    },
    finished: () => {
      running = false;
      const queued = next;
      next = null;
      if (queued !== null) ask(queued);
    },
    left: () => left,
    dispose: () => {
      stopTimer();
      next = null;
    },
  };
}
