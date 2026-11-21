import { useSyncExternalStore } from "react";
import { Internal } from "@valbuild/core";
import { lintWithValRules, pathsToLint, type LintMessage } from "./lintCode";
import { readProject, type ProjectReadDeps } from "./proposalCode";
import { BACKGROUND_TYPECHECK_DELAY_MS } from "./useProposalTypecheck";

/**
 * Val's lint rules over what a proposal stages, run by the tab after each
 * change, beside the background typecheck -- so the assistant does not have
 * to stop and ask. What it finds reaches the assistant on its next tool
 * answer (`toolNotices.ts`), once per staged inputs, as the typecheck's does.
 *
 * No model is involved: the problems are handed over as the rules wrote
 * them, file, line and rule, since that is what fixing them takes.
 */
export type BackgroundLintState =
  | { status: "idle" }
  | { status: "running"; name: string }
  | {
      status: "done";
      name: string;
      /** The staged inputs that were linted. */
      inputs: string;
      problems: LintMessage[];
    }
  | { status: "failed"; name: string; message: string };

/** How long after the last change a background lint starts: the typecheck's. */
export const BACKGROUND_LINT_DELAY_MS = BACKGROUND_TYPECHECK_DELAY_MS;

/** What a background lint reads, and lints with. */
export type BackgroundLintDeps = Omit<ProjectReadDeps, "proposal"> & {
  /** `lintWithValRules`, unless a test says otherwise. */
  lintCode?: typeof lintWithValRules;
};

const IDLE: BackgroundLintState = { status: "idle" };
let current: BackgroundLintState = IDLE;
const listeners = new Set<() => void>();
function set(next: BackgroundLintState) {
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Called on every change to it: what reacts to it outside React. */
export function subscribeBackgroundLint(listener: () => void): () => void {
  return subscribe(listener);
}
const snapshot = () => current;

let scheduled: { name: string; timer: ReturnType<typeof setTimeout> } | null =
  null;
let running: { name: string; done: Promise<void> } | null = null;
/** The staged inputs whose lint problems the assistant has been told of. */
const told = new Set<string>();

/** For tests: back to none. */
export function resetBackgroundLint() {
  current = IDLE;
  running = null;
  if (scheduled !== null) clearTimeout(scheduled.timer);
  scheduled = null;
  told.clear();
}

/**
 * Lint proposal `name` in the background once its staged files have stopped
 * changing for `delayMs`. One already running is let finish, and the files
 * are linted again after it, since they changed while it ran.
 */
export function scheduleLint(
  name: string,
  deps: BackgroundLintDeps,
  delayMs: number = BACKGROUND_LINT_DELAY_MS,
): void {
  if (scheduled !== null) clearTimeout(scheduled.timer);
  scheduled = {
    name,
    timer: setTimeout(() => {
      scheduled = null;
      if (running !== null && running.name === name) {
        void running.done.then(() => scheduleLint(name, deps, 0));
        return;
      }
      void runLint(name, deps);
    }, delayMs),
  };
}

/** Forget a background lint not started yet: its proposal was left. */
export function cancelScheduledLint(name: string): void {
  if (scheduled === null || scheduled.name !== name) return;
  clearTimeout(scheduled.timer);
  scheduled = null;
}

/**
 * Lint what proposal `name` stages now, or join the lint of it already
 * running. A lint of exactly what is staged, done already, is not run again.
 */
export function runLint(name: string, deps: BackgroundLintDeps): Promise<void> {
  if (running !== null && running.name === name) return running.done;
  const done = (async () => {
    try {
      const { project, staged } = await readProject({
        ...deps,
        proposal: { name },
      });
      const inputs = staged?.inputs ?? null;
      if (staged === null || inputs === null) {
        set(IDLE);
        return;
      }
      const before = snapshot();
      if (
        before.status === "done" &&
        before.name === name &&
        before.inputs === inputs
      ) {
        return;
      }
      set({ status: "running", name });
      const lintCode = deps.lintCode ?? lintWithValRules;
      const { messages } = await lintCode(
        project,
        pathsToLint(project, staged.files),
      );
      set({
        status: "done",
        name,
        inputs,
        problems: messages,
      });
    } catch (error) {
      // The assistant can still lint by itself; nothing here is for the
      // person, who never asked for this one.
      const message = error instanceof Error ? error.message : String(error);
      Internal.log.debug(`The background lint of ${name} failed: ${message}`);
      set({ status: "failed", name, message });
    } finally {
      running = null;
    }
  })();
  running = { name, done };
  return done;
}

/** Where proposal `name`'s background lint is. */
export function backgroundLintOf(name: string): BackgroundLintState {
  const state = snapshot();
  if (state.status === "idle" || state.name !== name) return IDLE;
  return state;
}

/**
 * Lint problems in what proposal `name` stages that the assistant has not
 * been told of. Once told (`markLintTold`), not again for the same inputs.
 */
export function untoldLintProblems(
  name: string,
): { inputs: string; problems: LintMessage[] } | null {
  const state = snapshot();
  if (state.status !== "done" || state.name !== name) return null;
  if (state.problems.length === 0 || told.has(state.inputs)) return null;
  return { inputs: state.inputs, problems: state.problems };
}

export function markLintTold(inputs: string): void {
  told.add(inputs);
}

/** The background lint, for what shows it. */
export function useBackgroundLint(): BackgroundLintState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
