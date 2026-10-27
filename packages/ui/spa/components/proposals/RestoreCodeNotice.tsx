import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { cn } from "../designSystem/cn";

/**
 * Bringing back the code of a point in the site's history, in the proposal a
 * "Go back to this point" opened (valbuild/home `docs/hosted-publishing.md`,
 * step 9). The content came with the proposal, as unsaved changes; the code
 * is staged here, when the Studio at the proposal's address loads.
 */
export type RestoreCodeState =
  | { kind: "restoring"; commit: string }
  | { kind: "restored"; commit: string }
  | { kind: "failed"; commit: string; message: string };

export function RestoreCodeNotice({
  state,
  onRetry,
  onDismiss,
}: {
  state: RestoreCodeState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const at = state.commit.slice(0, 7);
  const title =
    state.kind === "restoring"
      ? `Bringing back the code as it was at ${at}…`
      : state.kind === "restored"
        ? `The code is as it was at ${at}`
        : `The code as it was at ${at} could not be brought back`;
  const Icon =
    state.kind === "restoring"
      ? Loader2
      : state.kind === "restored"
        ? Check
        : AlertTriangle;
  return (
    <section
      role="status"
      aria-label={title}
      className="relative rounded-lg border border-border-proposal bg-bg-tertiary p-4"
    >
      <div className="flex gap-3">
        {/* The span spins, not the SVG: see designSystem/spinner. */}
        <span
          className={cn(
            "mt-0.5 inline-flex h-4 w-4 shrink-0",
            state.kind === "failed"
              ? "text-fg-error-primary"
              : "text-fg-proposal",
            state.kind === "restoring" && "animate-spin will-change-transform",
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">{title}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            {state.kind === "restoring"
              ? "Its files are staged in this proposal, and the build the site served then is served here."
              : state.kind === "restored"
                ? "Its files are staged in this proposal, and the site as it was is served here. The content as it was is in your unsaved changes: save it to keep it, and publish to put it all back on the site."
                : state.message}
          </p>
          {state.kind !== "restoring" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {state.kind === "failed" && (
                <button type="button" onClick={onRetry} className={PRIMARY}>
                  <RotateCcw size={12} /> Try again
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                  "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
                )}
              >
                {state.kind === "failed" ? "Keep the code as it is" : "Done"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const PRIMARY = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
  "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
);
