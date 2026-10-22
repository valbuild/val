import { useCurrentProposal } from "../components/ValProvider";
import { useValPortal } from "../components/ValPortalProvider";
import { useProposalsBar } from "../components/proposals/useProposalsBar";
import { Toaster } from "../components/designSystem/sonner";
import { UpgradeTabMessage } from "./UpgradeProgressPage";

/**
 * The upgrade tab (`upgradeTab.ts`): the Studio's proposals machinery --
 * the typecheck, the build, the publish -- with the upgrade's page in place
 * of the Studio. It is served cross-origin isolated in every browser, so the
 * build and the publish run here, and nothing is handed to another tab.
 */
export function UpgradeTabApp() {
  const portalContainer = useValPortal();
  const here = useCurrentProposal();
  const { upgradePage, dialogs } = useProposalsBar({
    unsaved: 0,
    portalContainer,
    upgradeTab: true,
  });
  if (here === null) {
    return (
      <UpgradeTabMessage message="This is the site's address, not an upgrade's: an upgrade runs at its proposal's address." />
    );
  }
  return (
    <>
      <Toaster />
      {upgradePage}
      {dialogs}
    </>
  );
}
