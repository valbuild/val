import {
  AlertTriangle,
  ArrowUpCircle,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { SettingsSection, SettingsSectionDivider } from "./SettingsPanel";
import { Button } from "../designSystem/button";
import { Spinner } from "../designSystem/spinner";
import { cn } from "../designSystem/cn";
import { kindsOf, type UpgradeKindTone } from "../../upgrade/upgradeKinds";
import type { UpgradePath } from "../../upgrade/upgradesClient";
import type { UpgradeSettings } from "../../upgrade/useUpgrade";

/**
 * Settings → Updates: what there is to upgrade in the site's dependencies,
 * and **Open in Val Build**, where the upgrade is made (valbuild/home
 * `docs/plans/upgrades-v2.md`, piece E): chosen there, typechecked, built,
 * checked by the new Val and published, with nothing of this Studio's code in
 * the way.
 *
 * Presentational: it imports no provider -- see
 * `settingsPanelPresentational.test.tsx` for why that matters. `ValShell`
 * hands it what the proposals bar's `useUpgrade` gives.
 */
export function SiteUpdateSection({ upgrade }: { upgrade: UpgradeSettings }) {
  return (
    <>
      <SettingsSection
        title="Updates"
        description="New versions of the packages your site is built with. Val Build makes each upgrade in a proposal, and checks it before anything on the site changes."
      >
        <UpdatesFound upgrade={upgrade} />
      </SettingsSection>
      <SettingsSectionDivider />
    </>
  );
}

function UpdatesFound({ upgrade }: { upgrade: UpgradeSettings }) {
  const { check, onOpen, onRecheck } = upgrade;
  if (check.status === "idle" || check.status === "checking") {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-secondary">
        <Spinner size={14} /> Checking the site&apos;s dependencies…
      </div>
    );
  }
  if (check.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2 text-xs">
        <p role="alert" className="flex items-start gap-1.5 text-fg-primary">
          <AlertTriangle
            size={14}
            className="mt-px shrink-0 text-fg-error-on-surface"
          />
          Val Build could not say whether there is anything to upgrade:{" "}
          {check.message}
        </p>
        <Button size="sm" variant="outline" onClick={onRecheck}>
          <RefreshCw size={13} /> Try again
        </Button>
      </div>
    );
  }
  if (check.check.state === "unavailable") {
    return <p className="text-xs text-fg-secondary">{check.check.message}</p>;
  }
  const result = check.check;
  const kinds = kindsOf(result);
  if (!result.available || kinds.length === 0) {
    return (
      <p className="text-xs text-fg-secondary">
        {result.cves.vulnerable > 0
          ? `The site's dependencies are up to date. ${result.cves.vulnerable === 1 ? "1 package is" : `${result.cves.vulnerable} packages are`} vulnerable, with no fix an upgrade can take yet.`
          : "The site's dependencies are up to date, and none is vulnerable."}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <ul className="w-full divide-y divide-border-primary overflow-hidden rounded-lg border border-border-primary">
        {kinds.map((kind) => {
          const Icon = KIND_ICON[kind.path];
          return (
            <li key={kind.path} className="flex gap-2.5 px-3 py-2.5">
              <Icon
                size={16}
                aria-hidden
                className={cn("mt-px shrink-0", ICON_TONE[kind.badge.tone])}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg-primary">
                    {kind.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
                      BADGE_TONE[kind.badge.tone],
                    )}
                  >
                    {kind.badge.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-fg-secondary">
                  {kind.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {onOpen !== null && (
        <Button size="sm" onClick={onOpen}>
          Open in Val Build <ExternalLink size={13} />
        </Button>
      )}
    </div>
  );
}

const KIND_ICON: Record<UpgradePath, LucideIcon> = {
  cves: ShieldAlert,
  latest: ArrowUpCircle,
  majors: AlertTriangle,
};

/** The danger in red, as an alert's icon is; the others plain. */
const ICON_TONE: Record<UpgradeKindTone, string> = {
  danger: "text-fg-error-on-surface",
  caution: "text-fg-secondary",
  recommended: "text-fg-secondary",
};

const BADGE_TONE: Record<UpgradeKindTone, string> = {
  danger: "bg-bg-error-primary text-fg-error-primary",
  caution: "bg-bg-warning-primary text-fg-warning-primary",
  recommended: "bg-bg-brand-primary text-fg-brand-primary",
};
