import type { CheckedUpgrades, UpgradePath } from "./upgradesClient";

/*
 * The three kinds of upgrade (valbuild/home `docs/adept.md`, decision 10;
 * `docs/plans/upgrades-v2.md`, piece A), as Settings → Updates says what the
 * check found: only the ones that move something, each by what it moves --
 * counts, and the Val it moves to. Choosing one is Val Build's: its Updates
 * page.
 */

/**
 * How a kind's badge reads: `danger` for what a vulnerability makes urgent,
 * `caution` for what can change how the site works, `recommended` for the
 * one to take.
 */
export type UpgradeKindTone = "danger" | "caution" | "recommended";

/** A kind of upgrade the check found something for. */
export type UpgradeKind = {
  path: UpgradePath;
  title: string;
  detail: string;
  /** A word or two beside the title: how bad, or how big. */
  badge: { label: string; tone: UpgradeKindTone };
  recommended: boolean;
};

const VAL_SCOPE = "@valbuild/";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The vulnerabilities Security fixes would fix. A check from before content
 * counted them says how many packages are vulnerable instead.
 */
export function fixableOf(check: CheckedUpgrades): number {
  return check.cves.fixable ?? check.cves.vulnerable;
}

/** The kinds of upgrade that move something, in the order they are offered. */
export function kindsOf(check: CheckedUpgrades): UpgradeKind[] {
  const kinds: UpgradeKind[] = [];
  const fixable = fixableOf(check);
  if (fixable > 0) {
    kinds.push({
      path: "cves",
      title: "Security fixes",
      detail: `Fixes ${plural(fixable, "vulnerability", "vulnerabilities")}, with the smallest change that does.`,
      badge: {
        label: check.cves.severity
          ? `${check.cves.severity[0].toUpperCase()}${check.cves.severity.slice(1)}`
          : plural(fixable, "fix", "fixes"),
        tone: "danger",
      },
      recommended: false,
    });
  }
  const latest = check.latest.packages;
  if (latest.length > 0) {
    const val = check.latest.val ?? null;
    const others = latest.filter((p) => !p.name.startsWith(VAL_SCOPE)).length;
    const rest = plural(others, "dependency", "dependencies");
    kinds.push({
      path: "latest",
      title: "Minor versions",
      detail:
        val !== null
          ? `Val ${val.from} → ${val.to}${others > 0 ? `, and ${rest} to the newest version of their major` : ""}.`
          : `${plural(latest.length, "dependency", "dependencies")} to the newest version of their major.`,
      badge: { label: "Recommended", tone: "recommended" },
      recommended: true,
    });
  }
  const majors = check.majors.packages;
  if (majors.length > 0) {
    kinds.push({
      path: "majors",
      title: "Full",
      detail: `Minor versions, and ${plural(majors.length, "dependency", "dependencies")} onto a new major version, which can change how it works. Built and typechecked before it can be published.`,
      badge: {
        label: plural(majors.length, "major"),
        tone: "caution",
      },
      recommended: false,
    });
  }
  return kinds;
}
