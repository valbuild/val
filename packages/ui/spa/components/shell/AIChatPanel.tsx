import { ReactNode } from "react";
import { FloatingPanel } from "./FloatingPanel";
import { ShellBreakpoint } from "./types";

export type AIChatPanelProps = {
  breakpoint: ShellBreakpoint;
  /**
   * Dismissed, but still mounted. See `FloatingPanel`'s `hidden`.
   *
   * The assistant is the one panel that cannot be unmounted on close: it holds
   * the conversation, the composer draft and — while a turn is running — the
   * only thing that can answer the model's tool calls.
   */
  hidden: boolean;
  onClose: () => void;
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
  hidden,
  onClose,
  children,
}: AIChatPanelProps) {
  return (
    <FloatingPanel
      side="right"
      width={420}
      title="AI assistant"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      hidden={hidden}
      onClose={onClose}
    >
      {/* `h-full` and no scrolling of its own: the chat is a column with its
          own scroll area for the transcript and a composer pinned under it, so
          a second scroller here would move the composer off screen. */}
      <div className="h-full overflow-hidden">{children}</div>
    </FloatingPanel>
  );
}
