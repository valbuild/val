import { Internal } from "@valbuild/core";
import type {
  BuildReport,
  BuildStepTimes,
  ProposalBuildControl,
  ProposalBuildOutcome,
  ProposalBuildStep,
} from "./proposalCode";

/**
 * The proposal's build, shared by everything in this Studio that starts one or
 * shows one: the top bar's Build button and the assistant's `build_proposal`.
 * One at a time -- the tab has one deploy -- and one answer for both, so the
 * button says "Building…" while the assistant builds.
 *
 * `changed` moves whenever what the proposal holds of its code may have: a
 * build finished, or a file tool staged something. The proposals bar reads the
 * proposal again on it, which is how "Build required" appears without a poll.
 */
export type ProposalBuildState = {
  building: boolean;
  /** Why the last build failed; cleared by the next. A cancel is not one. */
  error: string | null;
  changed: number;
  /**
   * Moves when something asked the person to open a proposal to change code
   * in: the assistant, on the site. The proposals bar opens New proposal.
   */
  proposalRequested: number;
  /**
   * Built in a builder tab, because this page cannot build (`canBuildHere`):
   * Safari, an iPhone. `blocked` while the browser has not let the tab open
   * -- the assistant's `build_proposal` is no tap -- and then Build opens it
   * (`openBuilder`). `step` is the tab's, as it reports it.
   */
  inTab: {
    blocked: boolean;
    step: string | null;
    percent?: number | null;
  } | null;
  /** Where a build in this page is, around its deploy; `null` when none is. */
  step: ProposalBuildStep | null;
  /** `Date.now()` when the running build started; `null` when none runs. */
  startedAt: number | null;
  /** The running build's steps so far, each with how long it took. */
  timings: BuildTiming[];
  /** The step it is on now, named as its timing will be. */
  stepLabel: string | null;
  /** How the last build ended, and what it took; `null` before the first. */
  last: LastBuild | null;
};

/** One step of a build, and how long it took. */
export type BuildTiming = { step: string; ms: number };

/** How a build ended, for `build_status` and the status's details. */
export type LastBuild = {
  status: "built" | "already-built" | "nothing-staged" | "failed" | "cancelled";
  message: string | null;
  /** The whole build. */
  ms: number;
  timings: BuildTiming[];
  endedAt: number;
};

const INITIAL: ProposalBuildState = {
  building: false,
  error: null,
  changed: 0,
  proposalRequested: 0,
  inTab: null,
  step: null,
  startedAt: null,
  timings: [],
  stepLabel: null,
  last: null,
};
let current: ProposalBuildState = INITIAL;
const listeners = new Set<() => void>();
/** Change the build's state: for the hook that runs builds, and nothing else. */
export function setProposalBuildState(next: Partial<ProposalBuildState>) {
  set(next);
}
function set(next: Partial<ProposalBuildState>) {
  current = { ...current, ...next };
  for (const listener of listeners) listener();
}
export function subscribeProposalBuild(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The build's state now, outside React: what the assistant's tools read. */
export function proposalBuildState(): ProposalBuildState {
  return current;
}

/** The proposal's code may have changed: read it again. */
export function proposalCodeChanged() {
  set({ changed: current.changed + 1 });
}

/** Ask the person to open a proposal: code is changed in one. */
export function requestProposal() {
  set({ proposalRequested: current.proposalRequested + 1 });
}

/** For tests: back to no build. */
export function resetProposalBuild() {
  running?.controller.abort();
  running = null;
  current = INITIAL;
}

/**
 * How long a build may go without moving on before it is stopped as stalled.
 *
 * Every step reports, and the upload reports each file, so this long without
 * a word is a request or a builder that will not answer -- which, before
 * this, was a build spinning until the tab was reloaded. Longer than any
 * single step takes when it works: the serving request is given up on by
 * its gateway in 100 seconds, and the wait after that has a limit of its own.
 */
export const BUILD_STALL_MS = 3 * 60_000;
const STALL_CHECK_MS = 5_000;

/** What a build is handed by `runProposalBuild`. */
export type ProposalBuildRun = {
  /** Stops it: Cancel, Try again, or the stall watchdog. */
  signal: AbortSignal;
  /** It moved on: a step began, a phase, a file uploaded. `label` names it. */
  progress: (label: string) => void;
};

let running: {
  promise: Promise<ProposalBuildOutcome>;
  controller: AbortController;
} | null = null;

/**
 * Build the proposal, or join the build already running. The outcome is the
 * same for everyone who asked.
 *
 * It can be stopped (`cancelProposalBuild`), and it is stopped when it stalls
 * (`BUILD_STALL_MS`): either way it ends at once and the next Build starts a
 * new one, rather than joining one that will never end.
 */
export function runProposalBuild(
  start: (run: ProposalBuildRun) => Promise<ProposalBuildOutcome>,
  options?: { now?: () => number; stallMs?: number },
): Promise<ProposalBuildOutcome> {
  if (running !== null) return running.promise;
  const now = options?.now ?? Date.now;
  const stallMs = options?.stallMs ?? BUILD_STALL_MS;
  const controller = new AbortController();
  const startedAt = now();
  const timings: BuildTiming[] = [];
  let stepNow: { label: string; at: number } | null = null;
  let lastProgress = startedAt;
  const progress = (label: string) => {
    const at = now();
    lastProgress = at;
    // One timing per step, however many times it reports (each upload).
    if (stepNow !== null && stepNow.label === label) return;
    if (stepNow !== null) {
      timings.push({ step: stepNow.label, ms: at - stepNow.at });
    }
    stepNow = { label, at };
    set({ timings: [...timings], stepLabel: label });
  };
  set({
    building: true,
    error: null,
    startedAt,
    timings: [],
    stepLabel: null,
  });
  const watchdog = setInterval(() => {
    // Not while it waits on a person (a builder tab not let open) or on the
    // wait for content, which has a limit of its own and says so.
    if (current.inTab?.blocked || current.step?.kind === "waiting") {
      lastProgress = now();
      return;
    }
    if (now() - lastProgress < stallMs) return;
    controller.abort(
      new Error(
        `The build made no progress for ${Math.round(stallMs / 60_000)} minutes ` +
          `while ${(stepNow?.label ?? "starting").toLowerCase()}, so it was stopped. ` +
          "Try again; if it stalls at the same step again, that step is where it hangs.",
      ),
    );
  }, STALL_CHECK_MS);
  const promise = start({ signal: controller.signal, progress })
    .catch(
      (error): ProposalBuildOutcome => ({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((outcome) => {
      clearInterval(watchdog);
      const endedAt = now();
      if (stepNow !== null) {
        timings.push({ step: stepNow.label, ms: endedAt - stepNow.at });
      }
      const cancelled = outcome.status === "failed" && outcome.cancelled;
      if (running?.controller === controller) running = null;
      set({
        building: false,
        error:
          outcome.status === "failed" && !cancelled ? outcome.message : null,
        changed: current.changed + 1,
        step: null,
        startedAt: null,
        timings: [],
        stepLabel: null,
        last: {
          status: cancelled ? "cancelled" : outcome.status,
          message: outcome.status === "failed" ? outcome.message : null,
          ms: endedAt - startedAt,
          timings: [...timings],
          endedAt,
        },
      });
      if (outcome.status === "built" || outcome.status === "failed") {
        Internal.log.info(
          `proposal build ${cancelled ? "cancelled" : outcome.status} in ` +
            `${((endedAt - startedAt) / 1000).toFixed(1)}s -- ` +
            timings
              .map((t) => `${t.step} ${(t.ms / 1000).toFixed(1)}s`)
              .join(", "),
        );
      }
      return outcome;
    });
  running = { promise, controller };
  return promise;
}

/**
 * Stop the running build, if there is one: it ends at once as cancelled, and
 * the next Build starts a new one. Whether there was one to stop.
 */
export function cancelProposalBuild(): boolean {
  if (running === null) return false;
  running.controller.abort();
  return true;
}

/** The running build, to wait for; `null` when none runs. */
export function runningProposalBuild(): Promise<ProposalBuildOutcome> | null {
  return running?.promise ?? null;
}

const seconds = (ms: number) => Math.round(ms / 100) / 10;
const stepTimes = (timings: BuildTiming[]): BuildStepTimes =>
  timings.map((t) => ({ step: t.step, seconds: seconds(t.ms) }));

/** The build's state as the assistant's tools answer it. */
export function buildReport(
  state: ProposalBuildState,
  now: number = Date.now(),
): BuildReport {
  if (state.building) {
    return {
      status: "building",
      step: state.inTab?.step ?? state.stepLabel,
      elapsed_seconds:
        state.startedAt === null ? 0 : seconds(now - state.startedAt),
      steps: stepTimes(state.timings),
    };
  }
  const last = state.last;
  return {
    status: "idle",
    last:
      last === null
        ? null
        : {
            status: last.status,
            ...(last.status === "failed" && last.message !== null
              ? { error: last.message }
              : {}),
            seconds: seconds(last.ms),
            steps: stepTimes(last.timings),
            ended_seconds_ago: Math.round((now - last.endedAt) / 1000),
          },
  };
}

/**
 * The build as the assistant's tools reach it, with `start` the hook's own
 * build (or `null` off a proposal).
 */
export function proposalBuildControl(
  start: (() => Promise<ProposalBuildOutcome>) | null,
): ProposalBuildControl {
  return {
    start: () =>
      start === null
        ? Promise.resolve({
            status: "failed",
            message: "Only a proposal is built here.",
          })
        : start(),
    running: runningProposalBuild,
    report: () => buildReport(current),
    cancel: cancelProposalBuild,
  };
}

/** A step of the build around its deploy, as its timing is named. */
export function stepLabel(step: ProposalBuildStep): string {
  switch (step.kind) {
    case "reading":
      return "Reading the proposal";
    case "deploying":
      return "Building";
    case "on-server":
      return "Building on Val Build";
    case "serving":
      return "Serving the build at the proposal's address";
    case "waiting":
      return "Waiting for Val Build to serve it";
  }
}
