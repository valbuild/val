import type { DeploymentSummary } from "../components/shell/Deployments";

/**
 * What the status bar's publish indicator says, apart from how it is decided
 * (`publishIndicator.ts`): the states and their words. Separate so the status
 * bar can draw one without importing the deploy feed's rules back.
 */

export type PublishIndicator =
  /** Something is being published and is not on the site yet. */
  | {
      kind: "publishing";
      /** This editor pressed it (or this tab is building it). */
      mine: boolean;
      /** The step, said as the builder says it: "Building", "Uploading 3 of 7". */
      step: string | null;
      /** How far this tab's build has got; null when it is built elsewhere. */
      percent: number | null;
    }
  /** Live, and the edges are still catching up. */
  | { kind: "reaching"; mine: boolean; everywhereAt: number }
  /** Connected: CI is building one or more pushed commits. */
  | { kind: "building"; count: number }
  /** This editor's publish, or the newest one in the feed, failed. */
  | { kind: "failed" }
  /** The newest publish was reported building over an hour ago. */
  | { kind: "unknown" }
  | { kind: "live" }
  | { kind: "none" };

/** The feed's own summary, as an indicator: no publish known to be running. */
export function indicatorOfSummary(
  summary: DeploymentSummary,
): PublishIndicator {
  switch (summary.state) {
    case "publishing":
      // A commit built in this tab, on its row: `publishIndicator` answers
      // that from the tab's own state before it asks the feed.
      return { kind: "publishing", mine: true, step: null, percent: null };
    case "building":
      return { kind: "building", count: summary.count };
    case "failed":
      return { kind: "failed" };
    case "unknown":
      return { kind: "unknown" };
    case "live":
      return { kind: "live" };
    case "none":
      return { kind: "none" };
  }
}

/** Whether the indicator spins: the site is not yet what was published. */
export function isInFlight(indicator: PublishIndicator): boolean {
  return (
    indicator.kind === "publishing" ||
    indicator.kind === "reaching" ||
    indicator.kind === "building"
  );
}

/** The indicator's words. Only three while a publish runs, so nothing jumps. */
export function describeIndicator(indicator: PublishIndicator): string {
  switch (indicator.kind) {
    case "publishing":
      return "Publishing";
    case "reaching":
      return "Reaching visitors";
    case "building":
      return indicator.count > 1
        ? `Building ${indicator.count} publishes`
        : "Building";
    case "failed":
      return "Not published";
    case "unknown":
      return "Deploy status unknown";
    case "live":
      return "Live";
    case "none":
      return "No deploys";
  }
}

/** The sentence behind it, on hover: the step, the wait, who. */
export function explainIndicator(
  indicator: PublishIndicator,
  now: number,
): string {
  switch (indicator.kind) {
    case "publishing":
      if (!indicator.mine)
        return "Another editor's changes are being published.";
      if (indicator.step === null) return "Your changes are being published.";
      return indicator.percent === null
        ? indicator.step
        : `${indicator.step} · ${indicator.percent}%`;
    case "reaching": {
      const left = Math.max(
        1,
        Math.ceil((indicator.everywhereAt - now) / 1000),
      );
      return `Live. Every visitor sees ${indicator.mine ? "your" : "the"} changes within ${left}s.`;
    }
    case "building":
      return "The site is being built from the published changes.";
    case "failed":
      return "The last publish did not go out. The site is unchanged.";
    case "unknown":
      return "The newest publish has not reported back for over an hour.";
    case "live":
      return "Every visitor sees the latest published changes.";
    case "none":
      return "Nothing has been published yet.";
  }
}
