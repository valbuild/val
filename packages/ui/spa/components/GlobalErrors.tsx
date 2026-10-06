import { useGlobalError } from "./ValProvider";
import ExhaustiveCheck from "./ExhaustiveCheck";

/**
 * The things that are wrong with the studio itself, rather than with content.
 *
 * Three of them are a banner saying something transient is failing. Remote
 * files being unavailable used to be the fourth -- a banner, or a dialog when
 * a personal access token was missing -- and is a card above the editor now:
 * it stops uploads and nothing else. See `RemoteFilesNotice`.
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
    /*
     * Not here: remote files being unavailable stops uploads and nothing
     * else, so it is a card above the editor rather than a banner over the
     * studio. See `RemoteFilesNotice`.
     */
    return null;
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
