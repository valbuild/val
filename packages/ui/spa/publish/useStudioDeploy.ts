/**
 * The deploy, as a React hook, with the one piece of state it produces.
 *
 * `runStudioDeploy` is the sequence and this is everything around it: which
 * client, which builder, which generator, and the phase an editor is shown
 * while it runs. Separate from `ValProvider`'s publish handler because it is
 * wanted in two places that are not the same event — a publish job's build,
 * and an update of the site's dependencies.
 *
 * ## It refuses to run twice
 *
 * A deploy is a build and a publish of the same commit, and two of them racing
 * would have the loser promote over the winner. `running` is checked rather
 * than the button being disabled, because the two callers are different
 * components and neither can see the other's state.
 *
 * ## It never rejects
 *
 * Same rule as the two layers under it. This runs behind a click handler and
 * behind an effect, and a rejection at an await boundary in either is a
 * spinner nobody can stop.
 */

import { useCallback, useRef, useState } from "react";
import type { BuildTarget } from "@valbuild/tanstack-build";
import { createStudioPublishClient } from "./publishClient";
import { fetchLiveStylesheet, fetchPublicFile } from "./fetchPublicFile";
import type { PreparedJob } from "./jobClient";
import { loadBuilder, routeTreeGenerator } from "./loadBuilder";
import {
  STUDIO_OUT_OF_DATE,
  loadedLayer,
  markStudioOutOfDate,
  readLiveLayer,
} from "./loadedLayer";
import {
  CommittedBinaryFiles,
  DeployPhase,
  StudioDeployResult,
  runStudioDeploy,
} from "./runStudioDeploy";

/** How long one step of a publish took. */
export type DeployStep = { kind: DeployPhase["kind"]; ms: number };

export type StudioDeployState =
  | { status: "idle" }
  | {
      status: "running";
      phase: DeployPhase;
      /** `Date.now()` when the publish, and when this step, began. */
      startedAt: number;
      phaseStartedAt: number;
      /** The steps finished so far, in order. */
      steps?: DeployStep[];
      /** The commit being published, so the deploy list can show it on its row. */
      commit: string | null;
    }
  | {
      status: "done";
      result: StudioDeployResult;
      /** The whole publish, and each step of it, in order. */
      ms: number;
      steps: DeployStep[];
      /** The step it stopped at, when it failed. */
      failedAt?: DeployPhase["kind"] | null;
      /** `Date.now()` when it ended. */
      finishedAt?: number;
      /**
       * The commit it published. A live one is a commit this Studio has seen
       * the site serve, the same as `/stat` reporting it -- which, polled as
       * rarely as it is in http mode, could otherwise be many minutes away.
       */
      commit: string | null;
    };

export interface UseStudioDeploy {
  state: StudioDeployState;
  /**
   * Build and publish the project at `commit`.
   *
   * `null` for a project that publishes from no commit. Answers what happened
   * as well as recording it, because the caller that has just committed wants
   * to say something and the one driving a retry wants to know whether to
   * stop.
   */
  deploy: (
    commit: string | null,
    /** What that commit wrote; see `committedFiles` on `runStudioDeploy`. */
    committedFiles?: Record<string, string | null> | null,
    /** Its binary files and branch; see `runStudioDeploy`. */
    details?: {
      binaryFiles: CommittedBinaryFiles | null;
      branch: string | null;
      /** An update's build target. See `target` on `runStudioDeploy`. */
      target?: BuildTarget;
      /** A publish job's build: stop once uploaded. See `until` on `runStudioDeploy`. */
      until?: "confirmed";
      /** The publish job it is for. See `job` on `runStudioDeploy`. */
      job?: string;
    } | null,
  ) => Promise<StudioDeployOutcome>;
}

/** What a deploy did, and -- when it failed -- the step it failed at. */
export type StudioDeployOutcome = {
  result: StudioDeployResult;
  failedAt: DeployPhase["kind"] | null;
};

/**
 * A publish job's build, as `runStudioJob` asks for it: at no commit -- the
 * job's is minted at the seal -- from what the server prepared, stopping once
 * the artifacts are confirmed.
 */
export async function deployPreparedJob(
  deploy: UseStudioDeploy["deploy"],
  prepared: PreparedJob,
): Promise<StudioDeployResult> {
  const { result } = await deploy(null, prepared.sourceFiles, {
    binaryFiles: {
      files: prepared.binaryFiles,
      unread: prepared.binaryFilesUnread,
    },
    branch: prepared.branch,
    until: "confirmed",
    ...(prepared.job !== null ? { job: prepared.job.id } : {}),
  });
  return result;
}

const ALREADY_RUNNING: StudioDeployResult = {
  status: "failed",
  message: "A publish is already being built.",
  problems: [],
};

export function useStudioDeploy(options?: {
  /** Val's API root on this origin. The Studio has one place this is decided. */
  api?: string;
}): UseStudioDeploy {
  const [state, setState] = useState<StudioDeployState>({ status: "idle" });
  /*
   * A ref, not the state above: two clicks in the same tick both read the same
   * render's state and both would start.
   */
  const running = useRef(false);
  const api = options?.api ?? "/api/val";

  const deploy = useCallback<UseStudioDeploy["deploy"]>(
    async (commit, committedFiles, details) => {
      if (running.current) {
        return { result: ALREADY_RUNNING, failedAt: null };
      }
      running.current = true;
      const startedAt = Date.now();
      const steps: DeployStep[] = [];
      let current: { phase: DeployPhase; at: number } = {
        phase: { kind: "getting-ready" },
        at: startedAt,
      };
      /*
       * One entry per step, however many times it reports: `uploading`
       * reports once per file, and the time is the step's, not the file's.
       */
      const enter = (phase: DeployPhase) => {
        const now = Date.now();
        if (phase.kind !== current.phase.kind) {
          steps.push({ kind: current.phase.kind, ms: now - current.at });
          current = { phase, at: now };
        } else {
          current = { phase, at: current.at };
        }
        setState({
          status: "running",
          phase,
          startedAt,
          phaseStartedAt: current.at,
          steps: [...steps],
          commit,
        });
      };
      setState({
        status: "running",
        phase: current.phase,
        startedAt,
        phaseStartedAt: startedAt,
        commit,
      });
      /*
       * Read once per deploy, not per use: whether a deployment has injected
       * one is settled when the publish starts, so a page cannot build half a
       * publish with a generator and half without.
       */
      const generateRouteTree = routeTreeGenerator();
      try {
        const loaded = await loadedLayer();
        const result = await runStudioDeploy({
          loadedLayer: loaded,
          liveLayer: () => readLiveLayer(),
          client: createStudioPublishClient({ api }),
          commit,
          committedFiles: committedFiles ?? null,
          committedBinaryFiles: details?.binaryFiles ?? null,
          branch: details?.branch ?? null,
          ...(details?.target ? { target: details.target } : {}),
          ...(details?.until ? { until: details.until } : {}),
          ...(details?.job !== undefined ? { job: details.job } : {}),
          fetchPublicFile: (path) => fetchPublicFile(path),
          liveStylesheet: () => fetchLiveStylesheet(),
          loadBuilder,
          ...(generateRouteTree !== null ? { generateRouteTree } : {}),
          onPhase: enter,
        });
        if (
          result.status === "failed" &&
          result.problems.some((problem) => problem.code === STUDIO_OUT_OF_DATE)
        ) {
          markStudioOutOfDate();
        }
        const now = Date.now();
        steps.push({ kind: current.phase.kind, ms: now - current.at });
        const ms = now - startedAt;
        /*
         * In the console as well as on screen, so a slow publish can be
         * reported with the step that was slow rather than as "it took ages".
         */
        console.info(
          `Val: publish ${result.status} in ${(ms / 1000).toFixed(1)}s -- ` +
            steps
              .map((step) => `${step.kind} ${(step.ms / 1000).toFixed(1)}s`)
              .join(", "),
        );
        // The step that was current when it returned is the one that failed.
        const failedAt = result.status === "failed" ? current.phase.kind : null;
        setState({
          status: "done",
          result,
          ms,
          steps,
          commit,
          failedAt,
          finishedAt: now,
        });
        return { result, failedAt };
      } finally {
        running.current = false;
      }
    },
    [api],
  );

  return { state, deploy };
}
