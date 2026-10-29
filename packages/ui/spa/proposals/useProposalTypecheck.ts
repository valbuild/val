import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Internal } from "@valbuild/core";
import { useCurrentProposal } from "../components/ValProvider";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import { Abandoned, runJob } from "../publish/adeptJob";
import { createUpgradesClient } from "../upgrade/upgradesClient";
import { TypecheckAbandoned } from "../typecheck/typecheckProtocol";
import type { Typechecker } from "../typecheck/typecheckWorkerClient";
import {
  runProposalTypecheck,
  type ProposalTypecheckStep,
} from "@valbuild/shared/typecheck";
import type { CodeTypecheck } from "./proposalCode";
import {
  createProposalsClient,
  type ProposalTypeError,
  type ProposalsClient,
} from "./proposalsClient";

/**
 * The typecheck of the proposal this Studio is in (valbuild/home
 * `docs/adept.md`, decision 20), shared by everything that starts or shows
 * one: the proposals bar, which starts it when a proposal with dependencies
 * of its own has none for what it stages, the Upgrade dialog, and Publish's
 * `types` check. One at a time: the worker checks one program after another.
 */
export type ProposalTypecheckState =
  | { status: "idle" }
  | { status: "running"; name: string; step: ProposalTypecheckStep | null }
  | {
      status: "done";
      name: string;
      inputs: string;
      errors: ProposalTypeError[];
    }
  | {
      status: "failed";
      name: string;
      message: string;
      /** Whether asking again can help: adept, or the network, failing. */
      retryable: boolean;
    };

const IDLE: ProposalTypecheckState = { status: "idle" };
let current: ProposalTypecheckState = IDLE;
const listeners = new Set<() => void>();
function set(next: ProposalTypecheckState) {
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => current;

/** For tests: back to none. */
export function resetProposalTypecheck() {
  current = IDLE;
  running = null;
  if (scheduled !== null) clearTimeout(scheduled.timer);
  scheduled = null;
  told.clear();
}

let running: { name: string; done: Promise<void> } | null = null;
let checker: Typechecker | null = null;

async function typechecker(): Promise<Typechecker> {
  if (checker === null) {
    const { createTypechecker } =
      await import("../typecheck/typecheckWorkerClient");
    checker = createTypechecker();
  }
  return checker;
}

/** Whether a failure can be got past by asking again. */
function retryableOf(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  )
    return error.retryable;
  return true;
}

/**
 * Typecheck proposal `name`, or join the typecheck of it already running.
 * Reports the result to content, then calls `onReported`.
 */
export function runTypecheck(
  name: string,
  client: Pick<ProposalsClient, "files" | "reportTypecheck">,
  onReported: () => void,
): Promise<void> {
  if (running !== null && running.name === name) return running.done;
  const abort = new AbortController();
  set({ status: "running", name, step: null });
  const upgrades = createUpgradesClient({ api: "/api/val" });
  const publish = createStudioPublishClient({ api: "/api/val" });
  const done = (async () => {
    try {
      const outcome = await runProposalTypecheck({
        name,
        client,
        siteSource: () => publish.projectSource(),
        siteDependencyFiles: () => upgrades.dependencyFiles(),
        computeLockfile: async (packageJson, signal) => {
          const result = await runJob(
            "/adept/lockfile",
            { files: { "package.json": packageJson } },
            () => {},
            signal,
          );
          const lockfile = result["lockfile"];
          if (typeof lockfile !== "string") {
            throw new Error("adept computed no lockfile for the site.");
          }
          return lockfile;
        },
        check: async (input, options) =>
          (await typechecker()).check(input, options),
        onStep: (step) => set({ status: "running", name, step }),
        signal: abort.signal,
      });
      if (outcome.status === "nothing-staged") {
        set(IDLE);
        return;
      }
      set({
        status: "done",
        name,
        inputs: outcome.inputs,
        errors: outcome.errors,
      });
      onReported();
    } catch (error) {
      if (error instanceof Abandoned || error instanceof TypecheckAbandoned) {
        set(IDLE);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      Internal.log.debug(`The typecheck of ${name} failed: ${message}`);
      set({
        status: "failed",
        name,
        message,
        retryable: retryableOf(error),
      });
    } finally {
      running = null;
    }
  })();
  running = { name, done };
  return done;
}

/**
 * How long after the last change to the staged files a background
 * typecheck starts: a few edits in a row are checked once, after them.
 */
export const BACKGROUND_TYPECHECK_DELAY_MS = 2_000;

let scheduled: { name: string; timer: ReturnType<typeof setTimeout> } | null =
  null;

/**
 * Typecheck proposal `name` in the background, once its staged files have
 * stopped changing for `delayMs` (the design tab: after each edit, and on
 * Build). One already running is let finish, and the files are checked
 * again after it, since they changed while it ran.
 */
export function scheduleTypecheck(
  name: string,
  client: Pick<ProposalsClient, "files" | "reportTypecheck">,
  onReported: () => void,
  delayMs: number = BACKGROUND_TYPECHECK_DELAY_MS,
): void {
  if (scheduled !== null) clearTimeout(scheduled.timer);
  scheduled = {
    name,
    timer: setTimeout(() => {
      scheduled = null;
      if (running !== null && running.name === name) {
        void running.done.then(() =>
          scheduleTypecheck(name, client, onReported, 0),
        );
        return;
      }
      void runTypecheck(name, client, onReported);
    }, delayMs),
  };
}

/** Where proposal `name`'s typecheck is, without starting one: the assistant's `typecheck_status`. */
export type TypecheckStatus =
  | { status: "none" }
  /** Its files changed: one starts once they stop changing. */
  | { status: "scheduled" }
  | { status: "running"; step: ProposalTypecheckStep | null }
  | { status: "done"; inputs: string; errors: ProposalTypeError[] }
  | { status: "failed"; message: string };

export function typecheckStatusOf(name: string): TypecheckStatus {
  if (scheduled !== null && scheduled.name === name) {
    return { status: "scheduled" };
  }
  const state = snapshot();
  if (state.status === "idle" || state.name !== name) return { status: "none" };
  if (state.status === "running")
    return { status: "running", step: state.step };
  if (state.status === "done") {
    return { status: "done", inputs: state.inputs, errors: state.errors };
  }
  return { status: "failed", message: state.message };
}

/** The staged inputs whose failed typecheck the assistant has been told of. */
const told = new Set<string>();

/**
 * A typecheck of proposal `name` that found type errors, and that the
 * assistant has not been told of yet. It hears of a failure of the
 * background check on its next tool call without having asked; once told
 * (`markTypeErrorsTold`), not again for the same staged files.
 */
export function untoldTypeErrors(
  name: string,
): { inputs: string; errors: ProposalTypeError[] } | null {
  const state = snapshot();
  if (state.status !== "done" || state.name !== name) return null;
  if (state.errors.length === 0 || told.has(state.inputs)) return null;
  return { inputs: state.inputs, errors: state.errors };
}

export function markTypeErrorsTold(inputs: string): void {
  told.add(inputs);
}

/**
 * The assistant's `typecheck`: the same run the bar and Publish start (one at
 * a time, reported to content so the proposal's Types check follows), with
 * what it came to. A check of exactly what is staged, done already in the
 * background, is answered at once.
 */
export async function typecheckProposal(
  name: string,
  client: Pick<ProposalsClient, "files" | "reportTypecheck">,
  onReported: () => void,
  stagedInputs?: () => Promise<string | null>,
): Promise<CodeTypecheck> {
  const before = snapshot();
  const now = stagedInputs === undefined ? undefined : await stagedInputs();
  if (
    now !== undefined &&
    now !== null &&
    before.status === "done" &&
    before.name === name &&
    before.inputs === now
  ) {
    told.add(before.inputs);
    return { status: "done", errors: before.errors };
  }
  await runTypecheck(name, client, onReported);
  const state = snapshot();
  if (state.status === "done" && state.name === name) {
    told.add(state.inputs);
    return { status: "done", errors: state.errors };
  }
  if (state.status === "failed" && state.name === name) {
    return { status: "failed", message: state.message };
  }
  return { status: "nothing-staged" };
}

export function useProposalTypecheck(options: {
  client?: ProposalsClient;
  /** Called once content has the result: read the proposal again. */
  onReported: () => void;
}): {
  state: ProposalTypecheckState;
  /** `null` off a proposal: nothing to check. */
  run: (() => Promise<void>) | null;
} {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const here = useCurrentProposal();
  const client = useMemo(
    () => options.client ?? createProposalsClient({ api: "/api/val" }),
    [options.client],
  );
  const name = here?.name ?? null;
  const { onReported } = options;
  const run = useCallback(
    () =>
      name === null
        ? Promise.resolve()
        : runTypecheck(name, client, onReported),
    [name, client, onReported],
  );
  return { state, run: name === null ? null : run };
}
