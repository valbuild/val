import { usePublish, useValPortal } from "./ValProvider";
import { Dialog, DialogContent } from "./designSystem/dialog";

export function PublishErrorDialog() {
  const { publishError, resetPublishError } = usePublish();
  const portalContainer = useValPortal();
  return (
    <Dialog
      open={!!publishError}
      onOpenChange={(open) => {
        if (!open) {
          resetPublishError();
        }
      }}
    >
      <DialogContent
        container={portalContainer}
        className="bg-bg-primary text-text-primary"
      >
        <div className="text-xl font-bold text-text-error-primary">
          Could not publish
        </div>
        <div>{publishError}</div>
      </DialogContent>
    </Dialog>
  );
}
