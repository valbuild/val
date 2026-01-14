import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
} from "./designSystem/dialog";
import { urlOf } from "@valbuild/shared/internal";
import { Button } from "./designSystem/button";
import { useValPortal } from "./ValProvider";

export function LoginDialog() {
  const portalContainer = useValPortal();
  return (
    <Dialog open={true} modal>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          container={portalContainer}
          aria-label="Login required"
          className="bg-bg-secondary text-fg-secondary"
        >
          <DialogHeader>
            <DialogTitle>
              <span>Log in required</span>
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            You need to log in to access Val.
          </DialogDescription>
          <Button asChild>
            <a
              href={urlOf("/api/val/authorize", {
                redirect_to: window.origin + urlOf("/val"),
              })}
            >
              Log in
            </a>
          </Button>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
