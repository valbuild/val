import { Button } from "./designSystem/button";
import { Dialog, DialogContent, DialogTitle } from "./designSystem/dialog";
import { useValPortal } from "./ValPortalProvider";
import { STUDIO_OUT_OF_DATE_MESSAGE } from "../publish/loadedLayer";

/**
 * A publish was refused because the site was updated after this Studio was
 * opened. See `publish/loadedLayer.ts`.
 *
 * Dismissable, unlike `SchemaOutOfDateDialog`: the schema is the same, so
 * editing on is safe -- it is only publishing from this version that is not.
 */
export function StudioOutOfDateDialog({ onClose }: { onClose: () => void }) {
  const portalContainer = useValPortal();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        container={portalContainer}
        className="max-w-md p-6 rounded-lg bg-bg-primary text-fg-primary"
      >
        <DialogTitle>Your site was updated</DialogTitle>
        <p>{STUDIO_OUT_OF_DATE_MESSAGE}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
