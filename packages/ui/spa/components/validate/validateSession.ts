import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { useSyncExternalStore } from "react";
import type { ModuleCheckResult } from "./buildValidateGroups";
import type { FixState } from "./ValidatePageView";

/**
 * What "Check everything" found, kept for the session.
 *
 * Outside React, because it has to outlive the page: a person who starts a
 * check and goes to edit something comes back to the results, and the top
 * bar's count includes them wherever the person is. A reload starts over, as
 * the plan says (`docs/plans/studio-validate.md`): nothing re-runs the check
 * behind anyone's back.
 */
export type CheckRun =
  | { status: "not-run" }
  | {
      status: "running";
      order: readonly ModuleFilePath[];
      checked: number;
    }
  | { status: "done"; at: number }
  | { status: "stopped"; checked: number; total: number }
  | { status: "failed"; message: string; details?: string };

/** A fix this session made, with the patch it made, so it can be undone. */
export type SessionFix = FixState & { patchId?: PatchId };

export type ValidateSessionState = {
  run: CheckRun;
  results: ReadonlyMap<ModuleFilePath, ModuleCheckResult>;
  fixes: Readonly<Record<string, SessionFix>>;
};

const INITIAL: ValidateSessionState = {
  run: { status: "not-run" },
  results: new Map(),
  fixes: {},
};

export class ValidateSession {
  private state: ValidateSessionState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private stopRequested = false;

  getSnapshot = (): ValidateSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: Partial<ValidateSessionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }

  start(order: readonly ModuleFilePath[]) {
    this.stopRequested = false;
    // A new run replaces what the last one found, and what was fixed from it:
    // those rows are gone or will be found again.
    this.set({
      run: { status: "running", order, checked: 0 },
      results: new Map(),
      fixes: {},
    });
  }

  /** Asked between modules, never inside one. */
  get shouldStop(): boolean {
    return this.stopRequested;
  }

  requestStop() {
    this.stopRequested = true;
  }

  recordModule(moduleFilePath: ModuleFilePath, result: ModuleCheckResult) {
    const results = new Map(this.state.results);
    results.set(moduleFilePath, result);
    const run = this.state.run;
    this.set({
      results,
      run:
        run.status === "running" ? { ...run, checked: run.checked + 1 } : run,
    });
  }

  /** A module that has nothing to report, counted all the same. */
  skipModule() {
    const run = this.state.run;
    if (run.status === "running") {
      this.set({ run: { ...run, checked: run.checked + 1 } });
    }
  }

  finish(now: number) {
    const run = this.state.run;
    if (run.status !== "running") {
      return;
    }
    this.set({
      run: this.stopRequested
        ? { status: "stopped", checked: run.checked, total: run.order.length }
        : { status: "done", at: now },
    });
  }

  fail(message: string, details?: string) {
    this.set({
      run: { status: "failed", message, ...(details ? { details } : {}) },
    });
  }

  setFix(rowId: string, fix: SessionFix | undefined) {
    const fixes = { ...this.state.fixes };
    if (fix) {
      fixes[rowId] = fix;
    } else {
      delete fixes[rowId];
    }
    this.set({ fixes });
  }
}

/** The one session this Studio has. */
export const validateSession = new ValidateSession();

export function useValidateSession(): ValidateSessionState {
  return useSyncExternalStore(
    validateSession.subscribe,
    validateSession.getSnapshot,
    validateSession.getSnapshot,
  );
}
