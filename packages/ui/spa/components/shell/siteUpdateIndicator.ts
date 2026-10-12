import type { DependencyChange } from "@valbuild/shared/internal";
import type { SiteUpdateView } from "../../publish/useSiteUpdate";

/**
 * What the shell shows about a site update outside the dialog: the badge on
 * the Quick actions button (top bar and phone bar alike) and the row inside
 * the panel. Plain functions, so the rules are tested without rendering.
 *
 * Nothing is shown while there is nothing anyone can do: still checking, up to
 * date, a project the platform will not update, or a check that failed (that
 * one is said in Settings → Updates, where Check again is; a badge for "we
 * could not ask" would be a badge nobody can clear).
 */
export type SiteUpdateIndicator =
  /** An update is available: this many packages move. */
  | { kind: "count"; count: number }
  /**
   * Something to open, with no number to put on it: an update that moves no
   * version (the platform rebuilt the same set), or one that is done and
   * waits for a reload.
   */
  | { kind: "dot" }
  /** It is running, here or in a builder tab. */
  | { kind: "busy" }
  /** It failed, or the builder tab was blocked: open it to see what to do. */
  | { kind: "attention" };

export function siteUpdateIndicator(
  view: SiteUpdateView,
): SiteUpdateIndicator | null {
  switch (view.status) {
    case "checking":
    case "current":
    case "unavailable":
    case "check-failed":
      return null;
    case "available":
      return view.changes.length > 0
        ? { kind: "count", count: view.changes.length }
        : { kind: "dot" };
    case "updating":
      return { kind: "busy" };
    case "blocked":
    case "failed":
      return { kind: "attention" };
    case "updated":
      return { kind: "dot" };
  }
}

/** The quick action's label, or `null` when it is not offered. */
export function siteUpdateActionLabel(view: SiteUpdateView): string | null {
  switch (view.status) {
    case "checking":
    case "current":
    case "unavailable":
    case "check-failed":
      return null;
    case "available":
      return "Show updates";
    case "updating":
      return view.percent === undefined
        ? "Updating site…"
        : `Updating site · ${view.percent}%`;
    case "blocked":
      return "Update waiting for its tab";
    case "failed":
      return "Update not published";
    case "updated":
      return "Site updated · reload";
  }
}

/**
 * The Quick actions button's accessible name. The badge is decorative, so
 * what it says has to be in the name, the way the bell's unread count is.
 */
export function quickActionsLabel(
  indicator: SiteUpdateIndicator | null,
): string {
  if (indicator === null) return "Quick actions";
  switch (indicator.kind) {
    case "count":
      return `Quick actions (${indicator.count} ${indicator.count === 1 ? "update" : "updates"} available)`;
    case "dot":
      return "Quick actions (site update)";
    case "busy":
      return "Quick actions (updating site)";
    case "attention":
      return "Quick actions (site update needs attention)";
  }
}

/** The badge's text: a count past nine is "9+", as the bell's is. */
export function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/** The scope every Val package is published under. */
const VAL_SCOPE = "@valbuild/";

/**
 * How the dialog names what moves: Val as one line, everything else folded
 * away. Editors are the readers, and to them the Val packages are one thing;
 * a developer expands the rest.
 *
 * Val's line is `@valbuild/core`'s change -- every Val package is released
 * together, and core is the one every project has -- or, failing that, the
 * first Val package that moves.
 */
export type SiteUpdateSummary = {
  val: { from: string | null; to: string | null } | null;
  /** Every change that is not a Val package, runtime dependencies first. */
  others: DependencyChange[];
};

export function summarizeChanges(
  changes: readonly DependencyChange[],
): SiteUpdateSummary {
  const val = changes.filter((change) => change.name.startsWith(VAL_SCOPE));
  const headline =
    val.find(
      (change) =>
        change.name === "@valbuild/core" && change.section === "dependencies",
    ) ?? val[0];
  const others = changes.filter((change) => !change.name.startsWith(VAL_SCOPE));
  return {
    val: headline ? { from: headline.from, to: headline.to } : null,
    others: [
      ...others.filter((change) => change.section === "dependencies"),
      ...others.filter((change) => change.section !== "dependencies"),
    ],
  };
}

/**
 * Where to read what a Val version changed: its GitHub release, which
 * changesets writes from the release notes. Templates pin Val exactly, but a
 * caret or a tilde still names the version it starts at; any other range, or
 * a tag, names no release.
 */
export function valReleaseUrl(version: string | null): string | null {
  const exact = version?.replace(/^[\^~]/, "");
  if (exact === undefined || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(exact)) {
    return null;
  }
  return `https://github.com/valbuild/val/releases/tag/${encodeURIComponent(
    `@valbuild/core@${exact}`,
  )}`;
}
