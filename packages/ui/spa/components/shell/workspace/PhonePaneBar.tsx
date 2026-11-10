import {
  Columns2,
  FileText,
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
 */
export function PhonePaneBar({
  panes,
  shown,
}: {
  panes: PhonePaneButton[];
  /** The pane on screen. */
  shown: WorkspacePane;
}) {
  return (
    <nav
      aria-label="Workspace panes"
      className={cn(
        "fixed inset-x-3 z-window flex items-stretch gap-1 rounded-xl border border-border-float bg-bg-float p-1 shadow-lg",
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
            data-val-tour={tour}
            onClick={onShow}
            className={cn(
              "relative flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.6875rem] font-medium",
              active
                ? "bg-bg-float-raised text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            <Icon size={18} aria-hidden />
            <span className="truncate">{label}</span>
            {changed && !active && (
              <span
                aria-hidden
                className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-bg-brand-primary"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
