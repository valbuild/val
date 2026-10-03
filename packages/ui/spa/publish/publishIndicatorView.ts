import type { DeploymentSummary } from "../components/shell/Deployments";

/**
 * What the status bar's publish indicator says, apart from how it is decided
 * (`publishIndicator.ts`): the states and their words. Separate so the status
 * bar can draw one without importing the deploy feed's rules back.
 */

/** How long a Cloudflare location may serve the build before the last one. */
export const EDGE_CACHE_MS = 60_000;

/**
 * Where the bar stands when the site goes live: past every step of the build
 * and the check (`deployPercent` tops out at 86, "Going live"), with the rest
 * left for the edges to catch up.
 */
const REACHING_FROM = 88;

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

/**
 * How far it has got, 0-99, or `null` for no bar: a publish built somewhere
 * that reports no numbers, and every state that is not on its way.
 *
 * The edges' minute is part of the bar. It fills from {@link REACHING_FROM}
 * with the clock, so the bar does not stall at Live and then vanish a minute
 * later -- it ends when the spinner does, when every visitor has the change.
 */
export function indicatorPercent(
  indicator: PublishIndicator,
  now: number,
): number | null {
  switch (indicator.kind) {
    case "publishing":
      return indicator.percent;
    case "reaching": {
      const left = Math.max(0, indicator.everywhereAt - now);
      const done = 1 - Math.min(1, left / EDGE_CACHE_MS);
      return Math.min(
        99,
        Math.round(REACHING_FROM + (100 - REACHING_FROM) * done),
      );
    }
    default:
      return null;
  }
}

/**
 * The indicator's words: Publishing, Reaching visitors, Live -- with the
 * percentage while there is one. The step is behind it, on hover.
 */
export function describeIndicator(
  indicator: PublishIndicator,
  now: number,
): string {
  const percent = indicatorPercent(indicator, now);
  const suffix = percent === null ? "" : ` ${percent}%`;
  switch (indicator.kind) {
    case "publishing":
      return `Publishing${suffix}`;
    case "reaching":
      return `Reaching visitors${suffix}`;
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
      return indicator.step ?? "Your changes are being published.";
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
