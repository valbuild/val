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
  /** Beside the work area rather than over it. See `FloatingPanel`. */
  docked?: boolean;
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

/** The assistant panel's width, which a docked panel takes from the work area. */
export const AI_PANEL_WIDTH = 420;

/**
 * The assistant panel: a surface holding the chat, floating over the work
 * area, or docked beside it on a desktop (see `ShellProps`'s `workspaceOverride`
 * and the shell's own `chatDocked`).
 */
export function AIChatPanel({
  breakpoint,
  hidden,
  docked,
  onClose,
  children,
}: AIChatPanelProps) {
  return (
    <FloatingPanel
      side="right"
      width={AI_PANEL_WIDTH}
      title="AI assistant"
      mobileVariant="bottom-sheet"
      // The chat is a transcript above a pinned composer, so the sheet has to
      // have a height for that column to fill. See `FloatingPanel`'s `fill`.
      fill
      breakpoint={breakpoint}
      hidden={hidden}
      docked={docked}
      onClose={onClose}
    >
      {/* `h-full` and no scrolling of its own: the chat is a column with its
          own scroll area for the transcript and a composer pinned under it, so
          a second scroller here would move the composer off screen. */}
      <div className="h-full overflow-hidden">{children}</div>
    </FloatingPanel>
  );
}
