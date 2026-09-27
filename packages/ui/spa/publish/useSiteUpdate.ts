/**
 * The site update, as the settings panel shows it.
 *
 * `runSiteUpdate` is the sequence; this is the question before it (is there
 * anything to update to?) and the state an editor is shown while it runs. The
 * deploy is the provider's, shared with the publish button, so an update and a
 * publish cannot run at once -- they would race to promote, and the loser would
 * put the site back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyChange } from "@valbuild/shared/internal";
import { createStudioPublishClient } from "./publishClient";
import { runSiteUpdate } from "./runSiteUpdate";
import { describeDeployPhase } from "./deployProgress";
import type { UseStudioDeploy } from "./useStudioDeploy";

export type SiteUpdateView =
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; changes: DependencyChange[] }
  /** The platform will not update this project; the message says why. */
  | { status: "unavailable"; message: string }
  | { status: "check-failed"; message: string }
  | { status: "updating"; step: string }
  | { status: "updated"; changes: DependencyChange[] }
  | { status: "failed"; message: string; details: string };

export type UseSiteUpdate = {
  view: SiteUpdateView;
  check: () => void;
  update: () => void;
};

export function useSiteUpdate(options: {
  deploy: UseStudioDeploy;
  /** Val's API root on this origin; the same default `useStudioDeploy` has. */
  api?: string;
}): UseSiteUpdate {
  const { deploy } = options;
  const api = options.api ?? "/api/val";
  const [view, setView] = useState<SiteUpdateView>({ status: "checking" });
  /** Set while an update runs, so a check that lands late cannot overwrite it. */
  const updating = useRef(false);

  /** Ask, and show the answer. Asynchronous all the way: see the effect below. */
  const load = useCallback(() => {
    createStudioPublishClient({ api })
      .updateTarget("check")
      .then((answer) => {
        if (updating.current) return;
        switch (answer.status) {
          case "current":
            setView({ status: "current" });
            return;
          case "available":
            setView({ status: "available", changes: answer.changes });
            return;
          case "unavailable":
            setView({ status: "unavailable", message: answer.message });
            return;
        }
      })
      .catch((error: unknown) => {
        if (updating.current) return;
        setView({
          status: "check-failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api]);

  // On mount the view already says `checking`, so this sets nothing until the
  // answer arrives.
  useEffect(() => {
    load();
  }, [load]);

  const check = useCallback(() => {
    if (updating.current) return;
    setView({ status: "checking" });
    load();
  }, [load]);

  const update = useCallback(() => {
    if (updating.current) return;
    updating.current = true;
    setView({ status: "updating", step: "Starting the update" });
    void runSiteUpdate({
      client: createStudioPublishClient({ api }),
      deploy: deploy.deploy,
    })
      .then((outcome) => {
        switch (outcome.status) {
          case "updated":
            setView({ status: "updated", changes: outcome.changes });
            return;
          case "current":
            setView({ status: "current" });
            return;
          case "unavailable":
            setView({ status: "unavailable", message: outcome.message });
            return;
          case "failed":
            setView({
              status: "failed",
              message: outcome.message,
              details: outcome.details,
            });
            return;
        }
      })
      .finally(() => {
        updating.current = false;
      });
  }, [api, deploy.deploy]);

  /*
   * The step, from the shared deploy's state rather than from the update's
   * own: the build and the publish are the deploy's, and it already narrates
   * them for the status bar.
   */
  const deployState = deploy.state;
  const shown: SiteUpdateView =
    view.status === "updating" && deployState.status === "running"
      ? { status: "updating", step: describeDeployPhase(deployState.phase) }
      : view;

  return { view: shown, check, update };
}
