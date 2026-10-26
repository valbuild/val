import { ArrowUpRight, CircleArrowUp, ShieldCheck } from "lucide-react";
import { cn } from "../designSystem/cn";
import type { ProposalUpgrade } from "../../proposals/proposalsClient";

/**
 * The Studio at an upgrade proposal's address. An upgrade changes the site's
 * dependencies and none of its content, so what is on the screen looks like
 * the site as it is -- said above the editor, with what it upgrades, and that
 * publishing it is what updates the site.
 *
 * Publish is the way on from here: whoever opened the proposal from Val
 * Build's upgrade page has looked at it, which is what that page sends them
 * here for. The checks stay in Val Build, linked.
 */
export function UpgradeProposalNotice({
  upgrade,
  siteName,
  onPublish,
  checksHref,
}: {
  upgrade: ProposalUpgrade;
  /** The project's name, when known: "update quiet-harbor-24". */
  siteName?: string;
  /** Absent while it cannot be published (it is still being checked). */
  onPublish?: () => void;
  /** The upgrade's page in Val Build, where its checks are. */
  checksHref?: string;
}) {
  // The site's Val is whichever framework binding it has, else any Val package.
  const val =
    upgrade.changes.find((change) => BINDINGS.includes(change.name)) ??
    upgrade.changes.find((change) => change.name.startsWith("@valbuild/")) ??
    null;
  const others = upgrade.changes.filter((change) => change !== val);
  const fixes =
    upgrade.vulnerableBefore !== null && upgrade.vulnerableAfter !== null
      ? upgrade.vulnerableBefore - upgrade.vulnerableAfter
      : 0;
  const title =
    upgrade.state === "computing"
      ? "Val Build is working out this upgrade"
      : upgrade.state === "failed"
        ? "This upgrade could not be worked out"
        : val !== null && val.from !== null && val.to !== null
          ? `This proposal upgrades Val ${val.from} → ${val.to}`
          : upgrade.path === "cves"
            ? "This proposal fixes security issues"
            : `This proposal upgrades ${upgrade.changes.length} packages`;
  const site = siteName ?? "the site";
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
              ? "It holds no content changes. When it is worked out and checked, it can be published from here."
              : upgrade.state === "failed"
                ? (upgrade.error ?? "Val Build has the details.")
                : `It holds no content changes: what you see is ${site} with newer packages. Look around, then publish it to update ${site}.`}
          </p>
          {upgrade.state === "staged" && (
            <details className="mt-2 text-xs text-fg-secondary">
              <summary className="cursor-pointer select-none">
                {others.length > 0 && val !== null
                  ? `And ${others.length} more ${others.length === 1 ? "package" : "packages"}`
                  : `${upgrade.changes.length} ${upgrade.changes.length === 1 ? "package" : "packages"}`}
                {fixes > 0 &&
                  ` · fixes ${fixes} security ${fixes === 1 ? "issue" : "issues"}`}
              </summary>
              <ul className="mt-1 grid gap-0.5 pl-4">
                {upgrade.changes.map((change) => (
                  <li key={change.name}>
                    <code className="text-fg-primary">{change.name}</code>{" "}
                    {change.from ?? "new"} → {change.to ?? "removed"}
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
          <div className="mt-3 flex flex-wrap gap-2">
            {onPublish !== undefined && upgrade.state === "staged" && (
              <button type="button" onClick={onPublish} className={PRIMARY}>
                Publish to update {site}
              </button>
            )}
            {checksHref !== undefined && (
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
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const BINDINGS = ["@valbuild/tanstack", "@valbuild/next"];

const PRIMARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
);
const SECONDARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
);
