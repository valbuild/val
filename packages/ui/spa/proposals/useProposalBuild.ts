import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  useCurrentProposal,
  useStudioDeployState,
} from "../components/ValProvider";
import { canBuildHere } from "../publish/handoff";
import { buildInTab, openBuilder as openBuilderTab } from "./buildInTab";
import {
  buildProposal,
  buildProposalOnServer,
  type ProposalBuildOutcome,
} from "./proposalCode";
import { serverFirst } from "./serverFirst";
import {
  proposalBuildProgress,
  type ProposalBuildProgress,
} from "./proposalBuildProgress";
import { createProposalsClient, type ProposalsClient } from "./proposalsClient";
import { describeDeployStep } from "../publish/deployProgress";
import {
  cancelProposalBuild,
  proposalBuildState,
  runProposalBuild,
  setProposalBuildState as set,
  stepLabel,
  subscribeProposalBuild,
  type ProposalBuildState,
} from "./proposalBuildStore";

/*
 * The build's state and the build itself live in `proposalBuildStore`, which
 * React and the Studio's provider stay out of; this is the hook over it.
 */
export {
  BUILD_STALL_MS,
  buildReport,
  cancelProposalBuild,
  proposalBuildControl,
  proposalBuildState,
  proposalCodeChanged,
  requestProposal,
  resetProposalBuild,
  runProposalBuild,
  runningProposalBuild,
  type BuildTiming,
  type LastBuild,
  type ProposalBuildRun,
  type ProposalBuildState,
} from "./proposalBuildStore";

/**
 * Open the builder tab the browser did not let open: from a tap, which it
 * allows. See `buildInTab`.
 */
export function openBuilder(): void {
  if (openBuilderTab()) set({ inTab: { blocked: false, step: null } });
}

/**
 * `proposalName`: the proposal to build, when it is not the one this Studio is
 * open in -- the design tab, which is served by the site's build and builds a
 * proposal it names (valbuild/home `docs/design-tab.md`).
 */
export function useProposalBuild(
  client?: ProposalsClient,
  proposalName?: string,
  options: {
    /**
     * Ask Val Build to build it first (`serverFirst`). The design tab's, and
     * the assistant's in it, while server builds roll out there first
     * (valbuild/home `docs/plans/server-builds.md`).
     */
    onServer?: boolean;
  } = {},
): {
  state: ProposalBuildState;
  /** `null` off a proposal: nothing to build. */
  build: (() => Promise<ProposalBuildOutcome>) | null;
  /** How far the running build is, in words; `null` when none runs. */
  progress: ProposalBuildProgress | null;
  /** Stop the running build: see {@link cancelProposalBuild}. */
  cancel: () => boolean;
} {
  const state = useSyncExternalStore(
    subscribeProposalBuild,
    proposalBuildState,
    proposalBuildState,
  );
  const here = useCurrentProposal();
  const { deploy, state: deployState } = useStudioDeployState();
  const proposals = useMemo(
    () => client ?? createProposalsClient({ api: "/api/val" }),
    [client],
  );
  const onServer = options.onServer ?? false;
  const name = proposalName ?? here?.name ?? null;
  const build = useCallback(
    () =>
      runProposalBuild(({ signal, progress }) => {
        const inThisPage = () =>
          !canBuildHere() && name !== null
            ? buildInTab(name, proposals, {
                onTab: (inTab) => {
                  set({ inTab });
                  if (inTab !== null) {
                    progress(inTab.step ?? "Opening the builder tab");
                  }
                },
                signal,
              })
            : buildProposal({
                name: name ?? "",
                client: proposals,
                canBuildHere,
                deploy: async (files, target, deploySignal) =>
                  (
                    await deploy(null, files, {
                      binaryFiles: null,
                      branch: null,
                      until: "confirmed",
                      ...(target ? { target } : {}),
                      ...(deploySignal !== undefined
                        ? { signal: deploySignal }
                        : {}),
                      onPhase: (phase) =>
                        progress(describeDeployStep(phase.kind)),
                    })
                  ).result,
                onStep: (step) => {
                  set({ step });
                  if (step.kind !== "deploying") progress(stepLabel(step));
                },
                signal,
              });
        if (name === null || !onServer) return inThisPage();
        return serverFirst(
          () =>
            buildProposalOnServer({
              name,
              client: proposals,
              onStep: (step) => {
                set({ step });
                progress(stepLabel(step));
              },
              signal,
            }),
          inThisPage,
        );
      }),
    [deploy, name, proposals, onServer],
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
  return {
    state,
    build: name === null ? null : build,
    progress,
    cancel: cancelProposalBuild,
  };
}
