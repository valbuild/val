import { AlertTriangle } from "lucide-react";
import { cn } from "../designSystem/cn";

/**
 * Something went wrong loading the account, and it is not going to fix itself.
 *
 * Not a banner across the top of the screen: the studio works fine without
 * knowing who anyone is — every field still edits, every patch still saves —
 * and a full-width error for something that does not stop you working teaches
 * people to dismiss errors. So it goes where the thing that failed would have
 * been, which is the account button, and the explanation goes inside the panel
 * that button opens.
 */
export type ShellAccountError = {
  /** In the server's words, e.g. "Project not found". */
  message: string;
  onRetry: () => void;
};

/** The dot on the account button. Small on purpose — see above. */
export function AccountErrorDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full",
        "bg-fg-error-on-surface ring-2 ring-bg-float",
        className,
      )}
    />
  );
}

/**
 * The explanation, and the way out of it.
 *
 * The retry is the point. Everything that can put this on screen is something
 * an editor might have just fixed in another window — a project id typed into
 * the config, a server restarted — and without a button the only way to find
 * out is to reload the studio and lose whatever is unsaved.
 */
export function AccountErrorNotice({ error }: { error: ShellAccountError }) {
  return (
    <div className="mx-4 my-3 rounded-md border border-border-error-primary bg-bg-error-secondary p-2.5">
      <div className="flex gap-2">
        <AlertTriangle
          size={13}
          className="mt-0.5 shrink-0 text-fg-error-on-surface"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-error-on-surface">
            Could not load your account
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-fg-secondary">
            {error.message}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={error.onRetry}
        className={cn(
          "mt-2 inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium",
          "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
        )}
      >
        Try again
      </button>
    </div>
  );
}
