import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/designSystem/dialog";
import { UpgradeChooser, type UpgradeStart } from "./UpgradeChooser";
import type { UpgradeCheckState } from "./useUpgradeCheck";
import type { UpgradePath } from "./upgradesClient";

/**
 * The Upgrade button's dialog: which kind of upgrade, and **Upgrade in a
 * proposal** (valbuild/home `docs/adept.md`, step 7). The proposal opens at
 * its own address, where the same dialog follows the upgrade to Publish.
 */
export function UpgradeDialog({
  open,
  onOpenChange,
  check,
  start,
  onStart,
  onRecheck,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  check: UpgradeCheckState;
  start: UpgradeStart;
  onStart: (path: UpgradePath, skip: string[]) => void;
  onRecheck: () => void;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Not while it is being prepared: closing would not stop it, and the
        // page goes to the upgrade when it is ready.
        if (start.status !== "preparing") onOpenChange(next);
      }}
    >
      <DialogContent
        container={portalContainer}
        className="max-w-md gap-0 border-border-float bg-bg-float p-0"
      >
        <div className="flex flex-col gap-1.5 px-5 pb-3 pt-5">
          <DialogTitle className="text-sm font-semibold">
            Upgrade the site&apos;s dependencies
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-secondary">
            New versions of the packages the site is built with.
          </DialogDescription>
        </div>
        <div className="px-5 pb-5">
          <UpgradeChooser
            check={check}
            start={start}
            onStart={onStart}
            onRecheck={onRecheck}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
