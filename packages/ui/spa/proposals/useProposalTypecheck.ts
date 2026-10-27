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
 * The assistant's `typecheck`: the same run the bar and Publish start (one at
 * a time, reported to content so the proposal's Types check follows), with
 * what it came to.
 */
export async function typecheckProposal(
  name: string,
  client: Pick<ProposalsClient, "files" | "reportTypecheck">,
  onReported: () => void,
): Promise<CodeTypecheck> {
  await runTypecheck(name, client, onReported);
  const state = snapshot();
  if (state.status === "done" && state.name === name) {
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
