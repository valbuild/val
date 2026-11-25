import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./designSystem/dialog";
import { urlOf } from "@valbuild/shared/internal";
import { Button } from "./designSystem/button";
import { useValPortal } from "./ValPortalProvider";

/**
 * The signed-out Studio: one dialog, one link.
 *
 * `DialogContent` brings its own portal and overlay, into the Studio's shadow
 * root. This wrapped it in a second pair, which radix put in `document.body`:
 * outside the shadow root, so styled by the SITE's stylesheet, and on a site
 * with Tailwind of its own that was a `fixed inset-0 z-50` layer over the
 * whole Studio. The Log in link could not be clicked, nor tapped on a phone.
 * See `e2e/http/loginDialog.spec.ts`.
 */
export function LoginDialog() {
  const portalContainer = useValPortal();
  return (
    <Dialog open={true} modal>
      <DialogContent
        container={portalContainer}
        aria-label="Login required"
        hideClose
        className="bg-bg-secondary text-fg-secondary"
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
              redirect_to: window.location.href,
            })}
          >
            Log in
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
