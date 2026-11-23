import { useCallback, useEffect, useRef, useState } from "react";
import {
  Blocks,
  Check,
  ChevronDown,
  Columns2,
  FileText,
  Link2,
  PencilRuler,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { DEMO_NEW_TAB_OFF, useValDemo } from "../../../demo/ValDemoContext";
import { useDismissOnOutsidePointer } from "../useDismissOnOutsidePointer";
import { PreviewMenuItem } from "../TopBar";
import type { WorkspacePane } from "./workspaceLayout";

/** One switch: a pane of the workspace, and whether it is open. */
export type PaneSwitch = {
  pane: WorkspacePane;
  open: boolean;
  onToggle: () => void;
  /**
   * Why it cannot be pressed: it is the last open pane (a workspace of
   * nothing is no use), or there is nothing to show in it.
   */
  unavailable?: string;
  /** The Sketchpad changed since this person looked. */
  changed?: boolean;
};

/**
 * What the Preview pane shows: the site's page, or (EXPERIMENTAL) its
 * components (`/val/components`). Chosen in the Preview switch's menu; the
 * switch itself then shows and hides whichever it is, the same way.
 */
export type PreviewSource = "page" | "components";

const PANE: Record<
  WorkspacePane,
  {
    label: string;
    icon: LucideIcon;
    /**
     * What it is called to assistive tech, open and closed. The names the
     * buttons they replace had, where there was one, so a tour step or a
     * test that found "Open the canvas" finds the same act.
     */
    name: { open: string; closed: string };
    tour?: string;
  }
> = {
  content: {
    label: "Content",
    icon: FileText,
    name: { open: "Close Content", closed: "Open Content" },
  },
  preview: {
    label: "Preview",
    icon: Columns2,
    name: { open: "Close the canvas", closed: "Open the canvas" },
    tour: "preview",
  },
  sketch: {
    label: "Sketch",
    icon: PencilRuler,
    name: { open: "Close the Sketchpad", closed: "Sketchpad" },
  },
  chat: {
    label: "Assistant",
    icon: Sparkles,
    name: { open: "AI assistant", closed: "AI assistant" },
    tour: "ai",
  },
};

/**
 * Content | Preview | Sketch | Assistant: the workspace's panes, switched on
 * and off from the top bar, in the Preview button's place (the plan's
 * "Decided"). Where each one goes is `workspaceLayout`'s; this only says
 * which are open. Labelled where the bar has room, icons where it does not.
 *
 * The Preview switch keeps the Preview button's other way to preview -- the
 * page in a new tab -- behind its chevron.
 */
export function PaneSwitches({
  switches,
  roomy,
  onPreview,
  previewHref,
  previewSource,
}: {
  switches: PaneSwitch[];
  /** Whether the bar has room for the words beside the icons. */
  roomy: boolean;
  onPreview: () => void;
  previewHref?: string;
  /**
   * What the Preview pane shows, and the way to change it - offered in the
   * Preview switch's menu, for a project that has components to show.
   */
  previewSource?: {
    current: PreviewSource;
    onChange: (source: PreviewSource) => void;
  };
}) {
  return (
    <div
      role="group"
      aria-label="Workspace panes"
      className="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border-float bg-bg-float p-0.5"
    >
      {switches.map((each) => {
        const pane = PANE[each.pane];
        const showsComponents =
          each.pane === "preview" && previewSource?.current === "components";
        const label = showsComponents ? "Components" : pane.label;
        const Icon = showsComponents ? Blocks : pane.icon;
        const { name, tour } = pane;
        const disabled = each.unavailable !== undefined;
        return (
          <span key={each.pane} className="inline-flex items-center">
            <button
              type="button"
              aria-pressed={each.open}
              aria-label={each.open ? name.open : name.closed}
              aria-disabled={disabled || undefined}
              title={each.unavailable ?? (each.open ? name.open : label)}
              data-val-tour={tour}
              onClick={() => {
                if (!disabled) each.onToggle();
              }}
              className={cn(
                "relative inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium",
                each.open
                  ? "bg-bg-float-raised text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary",
                disabled && "cursor-not-allowed hover:text-current",
              )}
            >
              <Icon size={13} />
              {roomy && label}
              {each.changed && !each.open && (
                <span
                  aria-hidden
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-bg-brand-primary"
                />
              )}
            </button>
            {each.pane === "preview" && (
              <OtherWaysToPreview
                onPreview={onPreview}
                previewHref={previewHref}
                previewSource={previewSource}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

const PREVIEW_SOURCES: {
  source: PreviewSource;
  label: string;
  detail: string;
  icon: LucideIcon;
}[] = [
  {
    source: "page",
    label: "Page",
    detail: "The page you are editing, as visitors see it",
    icon: Columns2,
  },
  {
    source: "components",
    label: "Components",
    detail: "Every component, and every place it is used",
    icon: Blocks,
  },
];

/**
 * The Preview switch's menu: what the pane shows (where there is a choice),
 * and the page in a new tab.
 */
function OtherWaysToPreview({
  onPreview,
  previewHref,
  previewSource,
}: {
  onPreview: () => void;
  previewHref?: string;
  previewSource?: {
    current: PreviewSource;
    onChange: (source: PreviewSource) => void;
  };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);
  const newTabOff = useValDemo() !== null ? DEMO_NEW_TAB_OFF : undefined;
  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label="Other ways to preview"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="grid h-7 w-5 place-items-center rounded text-fg-secondary hover:text-fg-primary"
      >
        <ChevronDown size={12} />
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-full mt-1 w-56 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          {previewSource !== undefined && (
            <>
              <div className="px-2.5 pb-1 pt-1 text-[0.6875rem] font-medium text-fg-secondary-alt">
                Show in the preview
              </div>
              {PREVIEW_SOURCES.map((option) => (
                <button
                  key={option.source}
                  type="button"
                  role="menuitemradio"
                  aria-checked={previewSource.current === option.source}
                  onClick={() => {
                    setIsOpen(false);
                    if (previewSource.current !== option.source) {
                      previewSource.onChange(option.source);
                    }
                  }}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
                >
                  <option.icon size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs">{option.label}</span>
                    <span className="block text-[0.6875rem] text-fg-secondary-alt">
                      {option.detail}
                    </span>
                  </span>
                  {previewSource.current === option.source && (
                    <Check size={14} className="mt-0.5 shrink-0" />
                  )}
                </button>
              ))}
              <div className="my-1 border-t border-border-float" />
            </>
          )}
          <PreviewMenuItem
            icon={Link2}
            label="Open in a new tab"
            detail="The page with your unpublished changes"
            href={previewHref}
            disabledReason={newTabOff}
            onClick={() => {
              setIsOpen(false);
              if (previewHref === undefined) onPreview();
            }}
          />
        </div>
      )}
    </span>
  );
}
