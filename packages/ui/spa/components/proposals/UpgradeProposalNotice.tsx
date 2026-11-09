import { ArrowUpRight, CircleArrowUp, ShieldCheck } from "lucide-react";
import { cn } from "../designSystem/cn";
import type { ProposalUpgrade } from "../../proposals/proposalsClient";

/**
 * What an upgrade moves, in the few words every place that names it uses:
 * the site's Val (whichever framework binding it has, else any Val package,
 * and only one whose version moved), how many more packages, and how many
 * security issues it fixes.
 */
export function describeUpgrade(upgrade: ProposalUpgrade): {
  /** "Val 0.149.4 → 0.149.7", or `null` when it does not move Val. */
  val: string | null;
  /** The packages besides Val's, or all of them when it does not move Val. */
  others: number;
  fixes: number;
} {
  // A range moved alone would read "Val 0.150.0 → 0.150.0".
  const moved = upgrade.changes.flatMap(({ name, from, to }) =>
    from !== null && to !== null && from !== to ? [{ name, from, to }] : [],
  );
  const val =
    moved.find((change) => BINDINGS.includes(change.name)) ??
    moved.find((change) => change.name.startsWith("@valbuild/")) ??
    null;
  const fixes =
    upgrade.vulnerableBefore !== null && upgrade.vulnerableAfter !== null
      ? upgrade.vulnerableBefore - upgrade.vulnerableAfter
      : 0;
  return {
    val: val !== null ? `Val ${val.from} → ${val.to}` : null,
    others: upgrade.changes.length - (val !== null ? 1 : 0),
    fixes,
  };
}

/**
 * The Studio at an upgrade proposal's address. An upgrade changes the site's
 * dependencies and none of its content, so what is on the screen looks like
 * the site as it is -- said above the editor, with what it upgrades, and that
 * publishing it is what updates the site.
 *
 * Publish itself is the top bar's, where it is for every proposal: the notice
 * offering a second one beside it was two buttons for one act. The checks
 * stay in Val Build, linked.
 */
export function UpgradeProposalNotice({
  upgrade,
  siteName,
  checksHref,
  contentChanges = 0,
}: {
  upgrade: ProposalUpgrade;
  /** The project's name, when known: "update quiet-harbor-24". */
  siteName?: string;
  /** The upgrade's page in Val Build, where its checks are. */
  checksHref?: string;
  /**
   * Content changed at the upgrade's address, saved or not. It holds them
   * too, and publishing it publishes them: the notice says so rather than
   * "no content changes".
   */
  contentChanges?: number;
}) {
  const { val, others, fixes } = describeUpgrade(upgrade);
  const title =
    upgrade.state === "computing"
      ? "Val Build is working out this upgrade"
      : upgrade.state === "failed"
        ? "This upgrade could not be worked out"
        : upgrade.state === "nothing"
          ? "There is nothing to upgrade"
          : val !== null
            ? `This proposal upgrades ${val}`
            : upgrade.path === "cves"
              ? "This proposal fixes security issues"
              : `This proposal upgrades ${upgrade.changes.length} packages`;
  const site = siteName ?? "the site";
  const content =
    contentChanges === 0
      ? `It holds no content changes: what you see is ${site} with newer packages.`
      : `It also holds ${contentChanges === 1 ? "1 content change" : `${contentChanges} content changes`}, made here, which are published with it.`;
  const Icon = upgrade.path === "cves" ? ShieldCheck : CircleArrowUp;
  return (
    <section
      role="status"
      aria-label={title}
      className="relative rounded-lg border border-border-proposal bg-bg-tertiary p-4"
    >
      <div className="flex gap-3">
        <Icon size={16} className="mt-0.5 shrink-0 text-fg-proposal" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">{title}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            {upgrade.state === "computing"
              ? "When it is worked out and checked, it can be published."
              : upgrade.state === "failed"
                ? (upgrade.error ?? "Val Build has the details.")
                : upgrade.state === "nothing"
                  ? `${site} is up to date. Discard this proposal from its menu.`
                  : `${content} Look around, then press Publish to update ${site}.`}
          </p>
          {upgrade.state === "staged" && (
            <details className="mt-2 text-xs text-fg-secondary">
              <summary className="cursor-pointer select-none">
                {val !== null && others > 0
                  ? `And ${others} more ${others === 1 ? "package" : "packages"}`
                  : `${upgrade.changes.length} ${upgrade.changes.length === 1 ? "package" : "packages"}`}
                {fixes > 0 &&
                  ` · fixes ${fixes} security ${fixes === 1 ? "issue" : "issues"}`}
              </summary>
              <ul className="mt-1 grid gap-0.5 pl-4">
                {upgrade.changes.map((change) => (
                  <li key={change.name}>
                    <code className="text-fg-primary">{change.name}</code>{" "}
                    {changeText(change)}
                    {change.kind === "major" && (
                      <span className="ml-1.5 rounded border border-border-primary px-1 text-[10px] uppercase">
                        major
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {checksHref !== undefined && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={checksHref}
                target="_blank"
                rel="noopener"
                className={SECONDARY}
              >
                {upgrade.state === "staged"
                  ? "See the checks in Val Build"
                  : "Open in Val Build"}
                <ArrowUpRight size={12} />
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * How a change reads after its name: `6.0.2 → 6.0.3`, or `range ^6.0.2 →
 * ^6.0.3` when only the range moved -- `6.0.3 → 6.0.3` reads as nothing.
 */
export function changeText(change: ProposalUpgrade["changes"][number]): string {
  const { from, to, fromRange, toRange } = change;
  if (
    from !== null &&
    from === to &&
    fromRange != null &&
    toRange != null &&
    fromRange !== toRange
  ) {
    return `range ${fromRange} → ${toRange}`;
  }
  return `${from ?? "new"} → ${to ?? "removed"}`;
}

const BINDINGS = ["@valbuild/tanstack", "@valbuild/next"];

const SECONDARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
);
