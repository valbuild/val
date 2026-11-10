import type { CSSProperties } from "react";
import { FileText, PenLine, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "../../designSystem/cn";
import type { SidePane } from "./workspaceLayout";

const PANES: Record<SidePane, { label: string; icon: LucideIcon }> = {
  content: { label: "Content", icon: FileText },
  sketch: { label: "Sketch", icon: PenLine },
  chat: { label: "Assistant", icon: Sparkles },
};

/**
 * Panes that did not fit, folded to a strip at their edge: what does not
 * fit is not closed, and one click brings it back (`workspaceLayout`'s rule
 * 2). Bringing one back makes it the pane in use, which is what keeps a
 * column.
 */
export function PaneStrip({
  panes,
  onUse,
  style,
  className,
}: {
  panes: SidePane[];
  onUse: (pane: SidePane) => void;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      data-val-pane-strip={panes.join(" ")}
      className={cn(
        "absolute top-20 bottom-14 flex flex-col items-center gap-1 rounded-lg border border-border-float bg-bg-float py-2",
        className,
      )}
      style={style}
    >
      {panes.map((pane) => {
        const { label, icon: Icon } = PANES[pane];
        return (
          <button
            key={pane}
            type="button"
            aria-label={`Show ${label}`}
            title={`Show ${label}`}
            onClick={() => onUse(pane)}
            className="flex w-8 flex-col items-center gap-2 rounded-md py-2 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <Icon size={16} />
            <span className="text-[11px] font-medium [writing-mode:vertical-rl]">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sketch and the Assistant sharing a column, as tabs: in the header of the
 * one in front, on its right (the plan's "Sketch and Assistant's header").
 */
export function SideTabs({
  tabs,
  front,
  onChange,
}: {
  tabs: ("sketch" | "chat")[];
  front: "sketch" | "chat";
  onChange: (pane: "sketch" | "chat") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Sketch and Assistant"
      className="ml-auto flex shrink-0 items-center gap-0.5 self-end rounded-md border border-border-float bg-bg-float p-0.5"
    >
      {tabs.map((pane) => {
        const { label, icon: Icon } = PANES[pane];
        return (
          <button
            key={pane}
            type="button"
            role="tab"
            aria-selected={pane === front}
            onClick={() => onChange(pane)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium",
              pane === front
                ? "bg-bg-float-raised text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
