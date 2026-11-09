import { AlertTriangle, RotateCw } from "lucide-react";
import { FailureDetails } from "./PublishHandoff";

/**
 * Your changes are not saved: the content service would not take them.
 *
 * The whole of what the editor has to know, with the one thing they can do
 * beside it. Shown while the write queue is `failed` (see `PatchSync`), which
 * is a save the service failed to take after a quick retry -- and NOT a patch
 * that was refused as bad, which is reverted and said by a toast, and not a
 * plan refusal, which the shell says with its own fix.
 *
 * Three things the old behaviour got wrong, and this is the answer to each:
 *
 * - The edit is KEPT. The field shows what was typed; nothing reverted it.
 * - It says the save FAILED, in the service's name, rather than leaving
 *   "All changes saved" on screen.
 * - Try again re-sends the same save. It is offered because it can work: the
 *   failure is the service's, and services recover. Val also tries again by
 *   itself, so a tab left open saves once the service is back.
 *
 * `details` is the service's status line and words -- what someone reporting
 * this has to paste -- closed by default.
 */
export function SaveFailedNotice({
  message,
  details,
  changeCount,
  onRetry,
}: {
  message: string;
  details?: string;
  changeCount: number;
  onRetry: () => void;
}) {
  const changes =
    changeCount === 1 ? "Your change is" : `Your ${changeCount} changes are`;
  return (
    <section
      role="alert"
      aria-label="Your changes could not be saved"
      className="relative rounded-lg border border-border-error-primary bg-bg-tertiary p-4"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 text-fg-error-primary">
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">
            Your changes could not be saved
          </p>
          <p className="mt-1 text-xs text-fg-secondary">{message}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            {changes} kept in this tab, and Val tries again by itself. Keep the
            tab open until they are saved.
          </p>
          {details !== undefined && details !== "" && (
            <FailureDetails details={details} />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-brand-primary bg-bg-brand-primary px-2.5 text-xs font-medium text-fg-brand-primary hover:bg-bg-brand-primary-hover"
            >
              <RotateCw size={12} /> Try again
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
