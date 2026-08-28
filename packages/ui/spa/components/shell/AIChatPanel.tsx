import { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { FloatingPanel } from "./FloatingPanel";
import { ShellBreakpoint } from "./types";

export type AIChatPanelProps = {
  breakpoint: ShellBreakpoint;
  onClose: () => void;
  /**
   * Why the assistant is unavailable, once the studio has stopped trying.
   *
   * Replaces the assistant rather than sitting above it. A chat with nothing
   * listening is an invitation to type a question that goes nowhere, and the
   * only feedback is silence — so where there is no assistant, the panel says
   * so and offers the one thing that can change it.
   */
  unavailable?: { message: string; onRetry: () => void };
  /**
   * The assistant itself.
   *
   * A slot, like the top bar's publish control, and for the same reason: the
   * shell is presentational and the assistant is not — it holds a socket, a
   * conversation and the implementation of every tool the model can call. This
   * panel owns where it sits and how it is dismissed, and nothing else.
   *
   * It used to own the chat as well, as a stand-in that echoed what you typed
   * into local state and called no tools. That was fine while the shell was
   * being designed and actively misleading once it shipped, because the panel
   * looked exactly like a working assistant.
   */
  children: ReactNode;
};

/**
 * The assistant panel: a floating surface holding the chat.
 */
export function AIChatPanel({
  breakpoint,
  onClose,
  unavailable,
  children,
}: AIChatPanelProps) {
  return (
    <FloatingPanel
      side="right"
      width={420}
      title="AI assistant"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
    >
      {/* `h-full` and no scrolling of its own: the chat is a column with its
          own scroll area for the transcript and a composer pinned under it, so
          a second scroller here would move the composer off screen. */}
      <div className="h-full overflow-hidden">
        {unavailable ? <AIUnavailable {...unavailable} /> : children}
      </div>
    </FloatingPanel>
  );
}

/**
 * The assistant is not there, and this is what is known about why.
 *
 * The retry matters more than the message: the usual causes are a key missing
 * from the server's config or the AI service being down, both of which can be
 * fixed in another window while this panel is open — and without a button the
 * only way to find out is to reload the studio.
 */
function AIUnavailable({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-3">
      <div className="rounded-md border border-border-float bg-bg-float-raised p-2.5">
        <div className="flex gap-2">
          <AlertTriangle
            size={13}
            className="mt-0.5 shrink-0 text-fg-error-on-surface"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-primary">
              The assistant is unavailable
            </p>
            <p className="mt-0.5 text-[0.6875rem] text-fg-secondary">
              {message}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex h-7 items-center rounded-md border border-border-primary px-2.5 text-xs font-medium text-fg-primary hover:bg-bg-float"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
