import { useEffect, type ReactNode } from "react";
import { ArrowUpCircle, ExternalLink } from "lucide-react";
import { useStudioIsDeployer } from "../components/ValProvider";
import { UpgradeProposalNotice } from "../components/proposals/UpgradeProposalNotice";
import type { ProposalJson } from "../proposals/proposalsClient";
import { useUpgradeCheck, type UpgradeCheckState } from "./useUpgradeCheck";
import { upgradeLabelOf } from "./upgradeLabel";

/*
 * Upgrades, as the Studio has them (valbuild/home
 * `docs/plans/upgrades-v2.md`, piece E): a notice. Val Build's admin app is
 * where a site is upgraded -- Updates, the upgrade's page, Publish -- so that
 * a Val bug never breaks the path that would fix it, and every hosted site
 * is upgraded the same way whatever Val it runs. What the Studio does is say
 * there is something to upgrade, and open the project's Updates in Val Build,
 * in a new tab.
 *
 * An upgrade already under way is followed there too: the Studio on the site
 * says one is running. The Studio at its proposal's address -- where Val
 * Build's Open the proposal goes -- says what it upgrades, that it holds no
 * content changes, and that publishing it updates the site, with Publish and
 * the way to its checks.
 */

/** How often the Studio on the site reads the list while an upgrade runs. */
const FOLLOW_MS = 10_000;

/** What the Studio's chrome needs for the Updates notice. */
export type UpgradeButton = {
  /** A vulnerability an upgrade fixes: the button is marked. */
  vulnerable: boolean;
  /** What there is: "Val 0.150.0 is out", or what kind of update. */
  label: string;
  /** Open the project's Updates in Val Build, in a new tab. */
  onOpen: () => void;
};

/** What Settings → Updates needs. */
export type UpgradeSettings = {
  check: UpgradeCheckState;
  /** Open the project's Updates in Val Build; `null` when it has no page. */
  onOpen: (() => void) | null;
  onRecheck: () => void;
};

/** A page of Val Build's, in a tab of its own: the Studio stays where it is. */
function openInValBuild(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function useUpgrade(input: {
  /** Proposals are on in this project: an upgrade is one. */
  enabled: boolean;
  /**
   * The project's page in Val Build (`toAdminLinks(...).project`); `null`
   * when it has none, and there is nowhere to send anyone.
   */
  adminProject: string | null;
  here: { name: string } | null;
  /** Every proposal, as the list has it: the site follows an upgrade by it. */
  proposals: ProposalJson[];
  current: ProposalJson | null;
  onRefresh: () => void;
  /** The project's own name, "quiet-harbor-24": what Publish updates. */
  siteName?: string;
  /** Publish this proposal, as the bar's Publish does. */
  onPublish?: () => void;
}): {
  /** `null` while there is nothing to upgrade, or nobody here can. */
  button: UpgradeButton | null;
  /** `null` where this Studio does not upgrade. */
  settings: UpgradeSettings | null;
  /**
   * Above the editor: on the site, an upgrade under way; at an upgrade
   * proposal's address, that it is followed in Val Build.
   */
  notice: ReactNode | null;
} {
  const { enabled, adminProject, here, current, proposals, onRefresh } = input;
  const { siteName, onPublish } = input;
  const deploys = useStudioIsDeployer();
  const usable = enabled && deploys && adminProject !== null;
  const { state: check, recheck } = useUpgradeCheck({ enabled: usable });
  const updatesUrl = adminProject === null ? null : `${adminProject}/updates`;
  const upgradeUrl = (name: string) =>
    `${adminProject}/updates/${encodeURIComponent(name)}`;

  // At an upgrade proposal's address: the upgrade it is.
  const hereUpgrade =
    here !== null &&
    current !== null &&
    current.name === here.name &&
    current.upgrade !== undefined
      ? current
      : null;

  const label = upgradeLabelOf(check);
  const vulnerable =
    check.status === "checked" &&
    check.check.state === "checked" &&
    check.check.cves.vulnerable > 0;
  const button: UpgradeButton | null =
    usable && updatesUrl !== null && label !== null && hereUpgrade === null
      ? { vulnerable, label, onOpen: () => openInValBuild(updatesUrl) }
      : null;
  const settings: UpgradeSettings | null = usable
    ? {
        check,
        onOpen: updatesUrl === null ? null : () => openInValBuild(updatesUrl),
        onRecheck: recheck,
      }
    : null;

  /*
   * On the site: an upgrade under way, until it is published or discarded,
   * with the way to its page. The list is read again while there is one,
   * since nothing else tells this page how it is doing.
   */
  const running =
    here === null && adminProject !== null
      ? (proposals.find(
          (p) =>
            p.upgrade !== undefined &&
            p.status !== "merged" &&
            p.status !== "closed",
        ) ?? null)
      : null;
  const following = running !== null;
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") onRefresh();
    }, FOLLOW_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") onRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [following, onRefresh]);

  const siteNotice =
    running === null ? null : (
      <UpgradeNotice
        text={`${running.displayName}: an upgrade is under way in Val Build.`}
        action={{
          label: "Open upgrade",
          onClick: () => openInValBuild(upgradeUrl(running.name)),
        }}
      />
    );
  const proposalNotice =
    hereUpgrade === null ||
    hereUpgrade.status !== "open" ||
    hereUpgrade.upgrade === undefined ? null : (
      <UpgradeProposalNotice
        upgrade={hereUpgrade.upgrade}
        {...(siteName !== undefined ? { siteName } : {})}
        {...(onPublish !== undefined ? { onPublish } : {})}
        {...(adminProject !== null
          ? { checksHref: upgradeUrl(hereUpgrade.name) }
          : {})}
      />
    );
  return { button, settings, notice: siteNotice ?? proposalNotice };
}

function UpgradeNotice({
  text,
  action,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border border-border-proposal bg-bg-proposal-soft px-4 py-3 text-xs text-fg-primary"
    >
      <span className="flex items-center gap-2">
        <ArrowUpCircle size={14} className="shrink-0 text-fg-proposal" />
        {text}
      </span>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-proposal px-2 font-medium hover:bg-bg-proposal-soft"
        >
          {action.label} <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}
