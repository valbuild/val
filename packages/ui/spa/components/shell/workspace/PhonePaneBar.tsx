import {
  Columns2,
  FileText,
  Maximize2,
  Minimize2,
  PencilRuler,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import type { WorkspacePane } from "./workspaceLayout";

/** One pane of the phone's bar: shown, and what tapping it does. */
export type PhonePaneButton = {
  pane: WorkspacePane;
  onShow: () => void;
  /** The Sketchpad changed since this person looked. */
  changed?: boolean;
};

const PANE: Record<
  WorkspacePane,
  {
    label: string;
    icon: LucideIcon;
    /** The tour's target, as on the top bar's switch for the same pane. */
    tour?: string;
  }
> = {
  content: { label: "Content", icon: FileText },
  preview: { label: "Preview", icon: Columns2, tour: "preview" },
  sketch: { label: "Sketch", icon: PencilRuler },
  chat: { label: "Assistant", icon: Sparkles, tour: "ai" },
};

/**
 * The phone's bottom bar: the workspace's panes, one on screen at a time
 * (`workspaceLayout`'s phone layout), and nothing else -- the plan's
 * "Decided". Save and Publish are in the top bar beside the account, and the
 * notifications in the account's sheet.
 *
 * A pane that is not open yet opens when it is tapped: the Sketchpad, the
 * preview, the assistant.
 *
 * Full screen is its last button, whichever pane is in front, so it is
 * entered and left from the same place. In full screen the top bar is gone
 * and this is a small row of icons in the middle, with the way out at its
 * end: every pane still one tap away, and nothing else on screen.
 */
export function PhonePaneBar({
  panes,
  shown,
  fullScreen,
  onFullScreenChange,
}: {
  panes: PhonePaneButton[];
  /** The pane on screen. */
  shown: WorkspacePane;
  fullScreen: boolean;
  onFullScreenChange: (fullScreen: boolean) => void;
}) {
  return (
    <nav
      aria-label="Workspace panes"
      className={cn(
        "fixed z-window flex items-stretch gap-1 rounded-xl border border-border-float bg-bg-float p-1 shadow-lg",
        fullScreen ? "left-1/2 -translate-x-1/2" : "inset-x-3",
        // Clear of the home indicator, as the bar it replaces was.
        "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      {panes.map(({ pane, onShow, changed }) => {
        const { label, icon: Icon, tour } = PANE[pane];
        const active = pane === shown;
        return (
          <button
            key={pane}
            type="button"
            aria-current={active ? "page" : undefined}
            aria-label={label}
            title={fullScreen ? label : undefined}
            data-val-tour={tour}
            onClick={onShow}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.6875rem] font-medium",
              fullScreen ? "h-10 w-10" : "h-12 flex-1",
              active
                ? "bg-bg-float-raised text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            <Icon size={18} aria-hidden />
            {!fullScreen && <span className="truncate">{label}</span>}
            {changed && !active && (
              <span
                aria-hidden
                className={cn(
                  "absolute h-2 w-2 rounded-full bg-bg-brand-primary",
                  fullScreen ? "right-1.5 top-1.5" : "right-3 top-1.5",
                )}
              />
            )}
          </button>
        );
      })}
      <div aria-hidden className="my-1.5 w-px shrink-0 bg-border-float" />
      <button
        type="button"
        aria-label="Full screen"
        aria-pressed={fullScreen}
        title={fullScreen ? "Leave full screen" : "Full screen"}
        onClick={() => onFullScreenChange(!fullScreen)}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg text-fg-secondary hover:text-fg-primary",
          fullScreen ? "h-10 w-10" : "h-12 w-10",
        )}
      >
        {fullScreen ? (
          <Minimize2 size={16} aria-hidden />
        ) : (
          <Maximize2 size={16} aria-hidden />
        )}
      </button>
    </nav>
  );
}
