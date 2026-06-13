import { Button } from "./designSystem/button";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "./designSystem/dialog";
import { useValPortal } from "./ValPortalProvider";

export function SchemaOutOfDateDialog() {
  const portalContainer = useValPortal();
  return (
    <Dialog open modal>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          container={portalContainer}
          className="max-w-md p-6 rounded-lg bg-bg-primary text-fg-primary"
          hideClose
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogTitle>A new version has been deployed</DialogTitle>
          <p>Reload to continue editing.</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
