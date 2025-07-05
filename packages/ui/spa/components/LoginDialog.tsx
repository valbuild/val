import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from "./designSystem/dialog";
import { urlOf } from "@valbuild/shared/internal";
import { Button } from "./designSystem/button";
import { DialogTitle } from "@radix-ui/react-dialog";
import { useValPortal } from "./ValProvider";

export function LoginDialog() {
  const portalContainer = useValPortal();
  return (
    <Dialog open={true} modal>
      <DialogContent
        container={portalContainer}
        aria-label="Login required"
        className="bg-bg-primary text-fg-primary"
      >
        <DialogHeader>
          <DialogTitle>
            <span>Log in required</span>
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>You need to log in to access Val.</DialogDescription>
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
    </Dialog>
  );
}
