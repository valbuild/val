import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { CopyableCodeBlock } from "../designSystem/CopyableCodeBlock";
import { getRemoteFilesError } from "../fields/remoteFilesError";

/**
 * Remote files are unavailable, said as SETUP rather than as a failure.
 *
 * It used to be a red bar across the top of the studio, over the top bar and
 * Publish, that could not be closed. That read as the studio being broken,
 * when all that is unavailable is UPLOADING: text edits save and publish as
 * normal. A project with `files: { remote: true }` and no project id - every
 * fresh checkout of a template - opened to it.
 *
 * So it is a card at the top of the editor column, in the same language as
 * `AccountErrorNotice`: critical (it names what does not work, and how to fix
 * it) without covering anything. Dismissed, it folds into
 * {@link UploadsOffChip} in the status bar, which brings it back, so the
 * problem stays in view until it is fixed. Fixed, it goes on its own: the
 * studio keeps asking for remote settings, and this is only shown while they
 * are `inactive`.
 */
export type RemoteFilesUnavailableReason = Parameters<
  typeof getRemoteFilesError
>[0];

type NoticeCopy = {
  title: string;
  body: string;
  action:
    | { kind: "link"; label: string; href: string }
    | { kind: "command"; code: string }
    | null;
};

const LOGIN_COMMAND = "npx -p @valbuild/cli val login";
const STILL_WORKS = "Text edits save and publish as normal.";

export function remoteFilesNoticeCopy(
  reason: RemoteFilesUnavailableReason,
): NoticeCopy {
  switch (reason) {
    case "project-not-configured":
      return {
        title: "Uploads aren't set up yet",
        body:
          "This project stores images, files and videos on Val's remote " +
          "host, so val.config needs a project id first. " +
          STILL_WORKS,
        action: {
          kind: "link",
          label: "Open admin.val.build",
          href: "https://admin.val.build",
        },
      };
    case "pat-error":
    case "unauthorized-personal-access-token-error":
      return {
        title: "Log in to upload files",
        body:
          "This project stores images, files and videos on Val's remote " +
          "host. To upload them from local development, run this in the " +
          "project's root. " +
          STILL_WORKS,
        action: { kind: "command", code: LOGIN_COMMAND },
      };
    case "api-key-missing":
      return {
        title: "Uploads aren't set up on this server",
        body:
          "This project stores images, files and videos on Val's remote " +
          "host, and this server needs the VAL_API_KEY environment variable " +
          "to reach it. " +
          STILL_WORKS,
        action: null,
      };
    case "unknown-error":
    case "error-could-not-get-settings":
    case "no-internet-connection":
    case "unauthorized":
      return {
        title: "Uploads are unavailable right now",
        body: `${getRemoteFilesError(reason)} ${STILL_WORKS}`,
        action: null,
      };
  }
}

export function RemoteFilesCard({
  reason,
  onDismiss,
}: {
  reason: RemoteFilesUnavailableReason;
  onDismiss: () => void;
}) {
  const copy = remoteFilesNoticeCopy(reason);
  return (
    <section
      role="status"
      aria-label={copy.title}
      className={cn(
        // The field cards' own surface and border, so it reads as part of the
        // studio rather than as something breaking it; the red is the icon
        // and the title, which is what says "critical". No coloured left
        // border: on a rounded card it curves into a pink edge.
        "relative rounded-lg border bg-bg-tertiary py-4 pl-4 pr-10",
      )}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded p-1 text-fg-secondary hover:bg-bg-float-raised"
      >
        <X size={14} />
      </button>
      <div className="flex gap-3">
        <AlertTriangle
          size={16}
          className="mt-0.5 shrink-0 text-fg-error-on-surface"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-error-on-surface">
            {copy.title}
          </p>
          <p className="mt-1 text-xs text-fg-secondary">{copy.body}</p>
          {copy.action?.kind === "link" && (
            <a
              href={copy.action.href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "mt-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
              )}
            >
              {copy.action.label}
              <ExternalLink size={12} />
            </a>
          )}
          {copy.action?.kind === "command" && (
            <CopyableCodeBlock code={copy.action.code} />
          )}
        </div>
      </div>
    </section>
  );
}

/** The card, dismissed: still in view, and one click from coming back. */
export function UploadsOffChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-fg-error-on-surface hover:underline"
    >
      <AlertTriangle size={13} />
      Uploads off
    </button>
  );
}
