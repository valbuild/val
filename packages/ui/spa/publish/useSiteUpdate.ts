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
import { runSiteUpdate, type SiteUpdateOutcome } from "./runSiteUpdate";
import { describeDeployPhase } from "./deployProgress";
import type { UseStudioDeploy } from "./useStudioDeploy";
import { canBuildHere, openHandoff, type SiteHandoff } from "./handoff";

export type SiteUpdateView =
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; changes: DependencyChange[] }
  /** The platform will not update this project; the message says why. */
  | { status: "unavailable"; message: string }
  | { status: "check-failed"; message: string }
  | { status: "updating"; step: string }
  /**
   * The builder tab this page opened was blocked by the browser. The update
   * is waiting for it; `openBuilderTab` opens it from a click, which is
   * allowed.
   */
  | { status: "blocked" }
  | { status: "updated"; changes: DependencyChange[] }
  | { status: "failed"; message: string; details: string };

export type UseSiteUpdate = {
  view: SiteUpdateView;
  check: () => void;
  /**
   * Call from the click itself, before anything awaits: where this page cannot
   * build (WebKit), the update runs in a tab opened here, and the browser only
   * allows that during the click.
   */
  update: () => void;
  /** Re-open a builder tab the browser blocked. See `blocked`. */
  openBuilderTab: () => void;
};

/** What an update's ending looks like in the section. */
export function viewOfOutcome(outcome: SiteUpdateOutcome): SiteUpdateView {
  switch (outcome.status) {
    case "updated":
      return { status: "updated", changes: outcome.changes };
    case "current":
      return { status: "current" };
    case "unavailable":
      return { status: "unavailable", message: outcome.message };
    case "failed":
      return {
        status: "failed",
        message: outcome.message,
        details: outcome.details,
      };
  }
}

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

  /** The builder tab an update was handed to, while it runs. */
  const handoff = useRef<SiteHandoff | null>(null);
  useEffect(() => () => handoff.current?.close(), []);

  const update = useCallback(() => {
    if (updating.current) return;
    updating.current = true;
    if (!canBuildHere()) {
      /*
       * A page that cannot build -- the Studio in WebKit, which is not cross
       * origin isolated -- hands the whole update to a Studio tab, which is.
       * The same channel a publish uses, with `update` in place of a commit:
       * nothing is saved first, so the message goes at once.
       */
      const tab = openHandoff();
      handoff.current = tab;
      setView(
        tab.opened
          ? { status: "updating", step: "Opening a tab to build the site" }
          : { status: "blocked" },
      );
      tab.onMessage((message) => {
        if (handoff.current !== tab) return;
        if (message.type === "phase") {
          setView({ status: "updating", step: message.label });
        } else if (message.type === "update-done") {
          setView(viewOfOutcome(message.outcome));
          tab.close();
          handoff.current = null;
          updating.current = false;
        }
      });
      tab.update();
      return;
    }
    setView({ status: "updating", step: "Starting the update" });
    void runSiteUpdate({
      client: createStudioPublishClient({ api }),
      deploy: deploy.deploy,
    })
      .then((outcome) => setView(viewOfOutcome(outcome)))
      .finally(() => {
        updating.current = false;
      });
  }, [api, deploy.deploy]);

  const openBuilderTab = useCallback(() => {
    const tab = handoff.current;
    if (tab === null) return;
    // The same id, so the tab finds the `update` this page is holding.
    window.open(tab.url, `val-publish-${tab.id}`);
    setView({ status: "updating", step: "Opening a tab to build the site" });
  }, []);

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

  return { view: shown, check, update, openBuilderTab };
}
