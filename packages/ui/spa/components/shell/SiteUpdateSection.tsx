import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { SettingsSection, SettingsSectionDivider } from "./SettingsPanel";
import { Button } from "../designSystem/button";
import { Spinner } from "../designSystem/spinner";
import { kindsOf } from "../../upgrade/upgradeKinds";
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
      <ul className="flex flex-col gap-2 text-xs">
        {kinds.map((kind) => (
          <li key={kind.path}>
            <span className="font-medium text-fg-primary">{kind.title}</span>
            <span className="text-fg-secondary"> · {kind.detail}</span>
          </li>
        ))}
      </ul>
      {onOpen !== null && (
        <Button size="sm" onClick={onOpen}>
          Open in Val Build <ExternalLink size={13} />
        </Button>
      )}
    </div>
  );
}
