import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  useCurrentProposal,
  useStudioDeployState,
} from "../components/ValProvider";
import { canBuildHere } from "../publish/handoff";
import { buildInTab, openBuilder as openBuilderTab } from "./buildInTab";
import {
  buildProposal,
  type ProposalBuildOutcome,
  type ProposalBuildStep,
} from "./proposalCode";
import {
  proposalBuildProgress,
  type ProposalBuildProgress,
} from "./proposalBuildProgress";
import { createProposalsClient, type ProposalsClient } from "./proposalsClient";

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
  /** Why the last build failed; cleared by the next. */
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
};

const INITIAL: ProposalBuildState = {
  building: false,
  error: null,
  changed: 0,
  proposalRequested: 0,
  inTab: null,
  step: null,
};
let current: ProposalBuildState = INITIAL;
const listeners = new Set<() => void>();
function set(next: Partial<ProposalBuildState>) {
  current = { ...current, ...next };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => current;

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
  current = INITIAL;
}

let running: Promise<ProposalBuildOutcome> | null = null;

/**
 * Build the proposal, or join the build already running. The outcome is the
 * same for everyone who asked.
 */
export function runProposalBuild(
  start: () => Promise<ProposalBuildOutcome>,
): Promise<ProposalBuildOutcome> {
  if (running !== null) return running;
  set({ building: true, error: null });
  running = start()
    .catch(
      (error): ProposalBuildOutcome => ({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((outcome) => {
      set({
        building: false,
        error: outcome.status === "failed" ? outcome.message : null,
        changed: current.changed + 1,
        step: null,
      });
      return outcome;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/**
 * Open the builder tab the browser did not let open: from a tap, which it
 * allows. See `buildInTab`.
 */
export function openBuilder(): void {
  if (openBuilderTab()) set({ inTab: { blocked: false, step: null } });
}

export function useProposalBuild(client?: ProposalsClient): {
  state: ProposalBuildState;
  /** `null` off a proposal: nothing to build. */
  build: (() => Promise<ProposalBuildOutcome>) | null;
  /** How far the running build is, in words; `null` when none runs. */
  progress: ProposalBuildProgress | null;
} {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const here = useCurrentProposal();
  const { deploy, state: deployState } = useStudioDeployState();
  const proposals = useMemo(
    () => client ?? createProposalsClient({ api: "/api/val" }),
    [client],
  );
  const name = here?.name ?? null;
  const build = useCallback(
    () =>
      runProposalBuild(() =>
        !canBuildHere() && name !== null
          ? buildInTab(name, proposals, {
              onTab: (inTab) => set({ inTab }),
            })
          : buildProposal({
              name: name ?? "",
              client: proposals,
              canBuildHere,
              deploy: async (files, target) =>
                (
                  await deploy(null, files, {
                    binaryFiles: null,
                    branch: null,
                    until: "confirmed",
                    ...(target ? { target } : {}),
                  })
                ).result,
              onStep: (step) => set({ step }),
            }),
      ),
    [deploy, name, proposals],
  );
  const progress: ProposalBuildProgress | null = !state.building
    ? null
    : state.inTab !== null
      ? {
          label: state.inTab.blocked
            ? "Waiting for the builder tab"
            : (state.inTab.step ?? "Opening the builder tab"),
          percent: state.inTab.percent ?? null,
        }
      : proposalBuildProgress(state.step, deployState);
  return { state, build: name === null ? null : build, progress };
}
