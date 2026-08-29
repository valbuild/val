import { useGlobalError } from "./ValProvider";
import { useValPortal } from "./ValPortalProvider";
import ExhaustiveCheck from "./ExhaustiveCheck";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "./designSystem/dialog";
import { CopyableCodeBlock } from "./designSystem/CopyableCodeBlock";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./designSystem/accordion";

/**
 * The things that are wrong with the studio itself, rather than with content.
 *
 * Four states, and they are not variations on one another: three are a banner
 * saying something transient is failing, and the fourth is a dialog because it
 * is not transient — remote files need a personal access token, and until the
 * editor runs a command in their terminal nothing they do will work.
 *
 * Rendered beside the shell rather than inside it, next to the other two
 * studio-wide surfaces (`PatchErrorsDialog`, `TransientErrorToasts`). It used
 * to live in the classic layout's `ContentArea`, which is why deleting that
 * left `useGlobalError` with no readers at all: a project whose PAT had expired
 * got no dialog, no command to run, and no clue why every remote upload failed.
 */
export function GlobalErrors() {
  const globalError = useGlobalError();
  if (globalError === null) {
    return null;
  }
  if (globalError.type === "network-error") {
    return <GlobalErrorBanner>Network error - retrying...</GlobalErrorBanner>;
  }
  if (globalError.type === "schema-error") {
    return (
      <GlobalErrorBanner>
        Schema error - check your console for details
      </GlobalErrorBanner>
    );
  }
  if (globalError.type === "profiles-auth-error") {
    return (
      <GlobalErrorBanner>
        Could not authenticate with your personal access token while getting
        profiles.
      </GlobalErrorBanner>
    );
  }
  if (globalError.type === "remote-files-error") {
    return <RemoteFilesErrorDialog error={globalError} />;
  }
  return <ExhaustiveCheck value={globalError} />;
}

/**
 * Across the top, above everything.
 *
 * Fixed rather than in the flow: the shell's bars are floating and the editor
 * scrolls underneath them, so a banner that took part in the layout would push
 * the whole studio down by its own height and then scroll away.
 */
function GlobalErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-full p-4 text-center text-fg-error-primary bg-bg-error-primary"
    >
      {children}
    </div>
  );
}

function RemoteFilesErrorDialog({
  error,
}: {
  error: { type: "remote-files-error"; error: string };
}) {
  const portalContainer = useValPortal();
  return (
    <Dialog defaultOpen={true}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          container={portalContainer}
          className="max-w-lg p-6 rounded-lg bg-bg-primary text-fg-primary"
        >
          <DialogTitle className="text-lg font-medium mb-4">
            Personal access token file required
          </DialogTitle>
          <div>
            <p>
              This project uses remote files, which means you need to be
              authenticated to update them.
            </p>
            <p>
              To do this locally in this dev environment, you need a Personal
              Access Token (PAT) stored in a file.
            </p>
            <p>
              Run the command in the root directory of your project to create
              the token file.
            </p>
          </div>
          <CopyableCodeBlock code="npx -p @valbuild/cli val login" />
          <div>
            <Accordion type="multiple">
              <AccordionItem value="why-pat">
                <AccordionTrigger>Why a personal token file?</AccordionTrigger>
                <AccordionContent>
                  <p>
                    You are using remote files, which require authentication. In
                    local development, Val uses a personal access token (PAT) to
                    authenticate and allow you to update remote files.
                  </p>
                  <p>
                    You can create it by running the command shown above, which
                    will create a PAT file.
                  </p>
                  <p>
                    If you have the PAT already, check that you have internet
                    access and that the project is setup correctly in
                    https://admin.val.build, as issues with either of those
                    could also cause this error.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="details">
                <AccordionTrigger>More details</AccordionTrigger>
                <AccordionContent>
                  <p>The underlying error message was: "{error.error}".</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
