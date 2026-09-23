/**
 * The deploy, as a React hook, with the one piece of state it produces.
 *
 * `runStudioDeploy` is the sequence and this is everything around it: which
 * client, which builder, which generator, and the phase an editor is shown
 * while it runs. Separate from `ValProvider`'s publish handler because it is
 * wanted in two places that are not the same event — a publish that has just
 * committed, and `Finish publishing` on a project whose commit landed and
 * whose build did not.
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
import { createStudioPublishClient } from "./publishClient";
import { loadBuilder, routeTreeGenerator } from "./loadBuilder";
import {
  DeployPhase,
  StudioDeployResult,
  runStudioDeploy,
} from "./runStudioDeploy";

export type StudioDeployState =
  | { status: "idle" }
  | { status: "running"; phase: DeployPhase }
  | { status: "done"; result: StudioDeployResult };

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
  deploy: (commit: string | null) => Promise<StudioDeployResult>;
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
    async (commit) => {
      if (running.current) {
        return ALREADY_RUNNING;
      }
      running.current = true;
      setState({ status: "running", phase: { kind: "getting-ready" } });
      /*
       * Read once per deploy, not per use: whether a deployment has injected
       * one is settled when the publish starts, so a page cannot build half a
       * publish with a generator and half without.
       */
      const generateRouteTree = routeTreeGenerator();
      try {
        const result = await runStudioDeploy({
          client: createStudioPublishClient({ api }),
          commit,
          loadBuilder,
          ...(generateRouteTree !== null ? { generateRouteTree } : {}),
          onPhase: (phase) => setState({ status: "running", phase }),
        });
        setState({ status: "done", result });
        return result;
      } finally {
        running.current = false;
      }
    },
    [api],
  );

  return { state, deploy };
}
