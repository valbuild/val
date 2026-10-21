import { SettingsSection, SettingsSectionDivider } from "./SettingsPanel";
import { UpgradeChooser } from "../../upgrade/UpgradeChooser";
import type { UpgradeSettings } from "../../upgrade/useUpgrade";

/**
 * Settings → Updates: upgrading the site's dependencies, in a proposal
 * (valbuild/home `docs/adept.md`, step 7). The same choice as the Upgrade
 * button's dialog -- fix vulnerabilities, the latest within the major, or new
 * majors -- and **Upgrade in a proposal**, which opens one: the upgrade is
 * computed, built and typechecked there, and published from there.
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
        description="New versions of the packages your site is built with, made and checked in a proposal before anything on the site changes."
      >
        <UpgradeChooser
          check={upgrade.check}
          start={upgrade.start}
          onStart={upgrade.onStart}
          onRecheck={upgrade.onRecheck}
        />
      </SettingsSection>
      <SettingsSectionDivider />
    </>
  );
}
