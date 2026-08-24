import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  ArrowUp,
  Ellipsis,
  Eye,
  EyeOff,
  GitCompareArrows,
  Globe,
  MessageSquare,
  Moon,
  SquareDashedMousePointer,
  Upload,
  X,
} from "lucide-react";
import {
  OverlayCard,
  OverlayDock,
  OverlayMenuBadge,
  OverlayMenuBar,
  OverlayMenuButton,
  OverlayMenuDivider,
  OverlaySelectionBox,
  OverlayTooltip,
  OverlayWindow,
  dockOrientation,
  overlayDockClassName,
} from "../OverlayMenu";
import { cn } from "../../designSystem/cn";
import { useShellBreakpoint } from "../useShellBreakpoint";

/**
 * The floating menu that sits over the user's own site.
 *
 * The mock page behind it is the point of this story: this bar is the most
 * invasive surface Val has, drawn on top of somebody else's design while they
 * are looking at their own brand. Judge it against the page, not on its own.
 *
 * Dark is the default. Use the `dock` control to move the bar to any of the
 * eight positions, and resize the preview to see the compact phone variant.
 */
const meta: Meta<typeof OverlayMenuHarness> = {
  title: "Shell/OverlayMenu",
  component: OverlayMenuHarness,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  argTypes: {
    dock: {
      control: "select",
      options: [
        "left-top",
        "left-center",
        "left-bottom",
        "center-top",
        "center-bottom",
        "right-top",
        "right-center",
        "right-bottom",
      ],
    },
    theme: { control: "inline-radio", options: ["dark", "light"] },
    previewMode: { control: "boolean" },
    pendingChanges: { control: "number" },
    validationErrors: { control: "number" },
    open: {
      control: "select",
      options: [null, "select", "edit", "chat", "settings", "tooltip"],
      description: "Which of the bar's buttons has been opened",
    },
  },
};
export default meta;

/** What a button opened, if anything. */
type OpenSurface = "select" | "edit" | "chat" | "settings" | "tooltip" | null;

type HarnessProps = {
  dock: OverlayDock;
  theme: "dark" | "light";
  /** In preview mode the bar shows the full editing toolset. */
  previewMode: boolean;
  pendingChanges: number;
  validationErrors: number;
  open: OpenSurface;
};

function OverlayMenuHarness({
  dock,
  theme,
  previewMode,
  pendingChanges,
  validationErrors,
  open,
}: HarnessProps) {
  const breakpoint = useShellBreakpoint();
  const compact = breakpoint === "mobile";
  const orientation = dockOrientation(dock);
  const [selectMode, setSelectMode] = useState(open === "select");
  const [chatOpen, setChatOpen] = useState(open === "chat");
  // Select mode marks every editable region, so the boxes are also shown
  // while the edit window is open — that is what a click on one leads to.
  const showBoxes = selectMode || open === "edit";
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: "100svh" }}
    >
      <HostPage />
      {/* The regions of the host page Val knows how to edit. Positions match
          the mock page's headline, intro and three cards. */}
      {showBoxes && (
        <div data-mode={theme} aria-hidden>
          {EDITABLE_REGIONS.map((rect, i) => (
            <OverlaySelectionBox
              key={i}
              rect={rect}
              emphasis={open === "edit" && i === 0 ? "hover" : "all"}
            />
          ))}
        </div>
      )}
      {open === "edit" && (
        // Beside the highlighted region, not on top of it: the point of the
        // window is to edit what you can still see.
        <div
          data-mode={theme}
          className={cn(
            "absolute z-40",
            compact ? "inset-x-3 top-[30%]" : "left-[48%] top-[16%]",
          )}
        >
          <EditWindow compact={compact} />
        </div>
      )}
      {chatOpen && (
        <div
          data-mode={theme}
          className={cn(
            "absolute z-40",
            compact ? "inset-x-3 bottom-24 top-16" : "right-6 bottom-24 top-16",
          )}
        >
          <ChatWindowMock compact={compact} />
        </div>
      )}
      <div data-mode={theme} className={cn(overlayDockClassName(dock), "z-50")}>
        <OverlayMenuBar orientation={orientation} compact={compact}>
          {previewMode ? (
            <>
              <OverlayMenuButton
                label="Select content to edit"
                compact={compact}
                active={selectMode}
                onClick={() => setSelectMode((v) => !v)}
                icon={<SquareDashedMousePointer size={16} />}
              />
              <OverlayMenuButton
                label="Exit preview mode"
                compact={compact}
                icon={<EyeOff size={16} />}
              />
              <OverlayMenuDivider orientation={orientation} />
              <div className="relative inline-flex">
                <OverlayMenuButton
                  label="Review changes in Studio"
                  compact={compact}
                  icon={<GitCompareArrows size={16} />}
                />
                <OverlayMenuBadge
                  count={
                    validationErrors > 0 ? validationErrors : pendingChanges
                  }
                  tone={validationErrors > 0 ? "error" : "neutral"}
                />
              </div>
              <PublishPill compact={compact} count={pendingChanges} />
              <OverlayMenuButton
                label="Open Val Studio"
                compact={compact}
                icon={<Globe size={16} />}
              />
              <OverlayMenuButton
                label="Open AI chat"
                compact={compact}
                active={chatOpen}
                onClick={() => setChatOpen((v) => !v)}
                icon={<MessageSquare size={16} />}
              />
              <OverlayMenuDivider orientation={orientation} />
              <OverlayMenuButton
                label="Menu position and theme"
                compact={compact}
                icon={<Ellipsis size={16} />}
              />
            </>
          ) : (
            <>
              <OverlayMenuButton
                label="Enable preview mode"
                compact={compact}
                icon={<Eye size={16} />}
              />
              <OverlayMenuButton
                label="Open Val Studio"
                compact={compact}
                icon={<Globe size={16} />}
              />
              <OverlayMenuDivider orientation={orientation} />
              <OverlayMenuButton
                label="Disable Val"
                compact={compact}
                icon={<X size={16} />}
              />
            </>
          )}
        </OverlayMenuBar>
        {open === "settings" && (
          <SettingsPopover className="absolute bottom-full right-0 mb-2" />
        )}
        {open === "tooltip" && (
          <OverlayTooltip className="absolute bottom-full left-0 mb-2">
            Click on content in the page to select and edit it
          </OverlayTooltip>
        )}
      </div>
    </div>
  );
}

/**
 * Where Val can edit on the mock page. Percentages so the boxes track the
 * host page across viewport sizes rather than drifting off it.
 */
const EDITABLE_REGIONS = [
  { top: "17%", left: "2%", width: "42%", height: "12%" },
  { top: "32%", left: "2%", width: "36%", height: "6%" },
  { top: "42%", left: "2%", width: "16%", height: "34%" },
  { top: "42%", left: "18.5%", width: "16%", height: "34%" },
  { top: "42%", left: "35%", width: "16%", height: "34%" },
];

/** The window a click on a selected region opens. */
function EditWindow({ compact }: { compact: boolean }) {
  return (
    <OverlayWindow
      title="Edit content"
      compact={compact}
      onClose={() => undefined}
      style={{ width: compact ? "min(20rem, 88vw)" : 420 }}
    >
      <div className="p-4 space-y-5">
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[0.8125rem] font-medium">Headline</span>
            <span className="text-[0.6875rem] text-fg-secondary-alt font-mono">
              /content/home.val.ts
            </span>
          </div>
          <div className="px-3 py-2 rounded-md border border-border-float bg-bg-surface text-[0.9375rem] leading-snug">
            Clothes that outlast the season.
          </div>
        </div>
        <div>
          <div className="mb-2 text-[0.8125rem] font-medium">Eyebrow</div>
          <div className="h-10 px-3 flex items-center rounded-md border border-border-float bg-bg-surface text-[0.9375rem]">
            Autumn 2026
          </div>
        </div>
      </div>
    </OverlayWindow>
  );
}

/** The assistant, opened from the bar. */
function ChatWindowMock({ compact }: { compact: boolean }) {
  return (
    <OverlayWindow
      title="AI assistant"
      compact={compact}
      onClose={() => undefined}
      className="h-full"
      style={{ width: compact ? undefined : 360 }}
      footer={
        <div className="p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {["Improve this page", "Shorten the headline"].map((s) => (
              <span
                key={s}
                className="h-7 px-2 inline-flex items-center rounded-full text-[0.6875rem] text-fg-secondary border border-border-float"
              >
                {s}
              </span>
            ))}
          </div>
          <div className="flex items-end gap-1.5 p-1.5 rounded-lg bg-bg-float-raised">
            <span className="flex-1 px-1.5 py-1 text-xs text-fg-secondary-alt">
              Ask anything about this page…
            </span>
            <span className="grid place-items-center w-7 h-7 shrink-0 rounded-md bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary">
              <ArrowUp size={14} />
            </span>
          </div>
        </div>
      }
    >
      <div className="p-3 space-y-3">
        <div className="flex justify-end">
          <p className="max-w-[85%] px-2.5 py-1.5 rounded-lg rounded-br-sm bg-bg-float-raised text-xs">
            Shorten the headline a little.
          </p>
        </div>
        <div className="max-w-[85%] space-y-2">
          <p className="text-xs leading-relaxed">
            Here is a shorter version. It keeps the promise but drops the
            qualifier.
          </p>
          <div className="rounded-md border border-border-float bg-bg-surface overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border-float text-[0.625rem] text-fg-secondary-alt">
              Home › Hero › Headline
            </div>
            <p className="px-2.5 py-2 text-xs">Clothes that outlast.</p>
            <div className="flex gap-1.5 px-2.5 pb-2">
              <span className="h-6 px-2 inline-flex items-center rounded text-[0.6875rem] font-medium bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary">
                Apply
              </span>
              <span className="h-6 px-2 inline-flex items-center rounded text-[0.6875rem] text-fg-secondary border border-border-float">
                Try another
              </span>
            </div>
          </div>
        </div>
      </div>
    </OverlayWindow>
  );
}

/** What the "…" button opens: where the bar sits, and which theme it uses. */
function SettingsPopover({ className }: { className?: string }) {
  return (
    <OverlayCard className={cn("w-56", className)}>
      <div className="grid grid-cols-[1fr,auto] gap-2 items-center text-xs">
        <span className="text-fg-secondary">Position</span>
        <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-border-float">
          Bottom centre
        </span>
        <span className="text-fg-secondary">Theme</span>
        <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-border-float">
          <Moon size={12} />
          Dark
        </span>
      </div>
    </OverlayCard>
  );
}

/**
 * Publish is the one control in the bar that commits something, so it is the
 * one that carries the brand colour.
 *
 * Icon and count only, no label — this mirrors the real `PublishButton` in its
 * `compact` form, and it is what keeps the bar inside a 320px viewport.
 */
function PublishPill({ compact, count }: { compact: boolean; count: number }) {
  return (
    <button
      type="button"
      disabled={count === 0}
      aria-label={count > 0 ? `Publish ${count} changes` : "Nothing to publish"}
      title={count > 0 ? `Publish ${count} changes` : "Nothing to publish"}
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md text-xs font-medium",
        "bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary",
        "hover:bg-bg-brand-primary-hover",
        "disabled:bg-bg-disabled disabled:text-fg-disabled disabled:border-border-float",
        compact ? "h-7 px-1.5" : "h-8 px-2",
      )}
    >
      <Upload size={14} />
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

/**
 * A stand-in for the customer's site: their brand colour, their type, their
 * layout. Nothing here uses Val's tokens — the whole point is to see whether
 * the bar can sit on top of a design it knows nothing about.
 */
function HostPage() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#fdf8f3] text-[#2b1a12]">
      <header className="flex items-center gap-8 px-10 h-20 border-b border-[#e8d9c9]">
        <span className="text-xl font-bold tracking-tight text-[#c2410c]">
          Nordic Retail
        </span>
        <nav className="flex gap-6 text-sm">
          {["Shop", "Stores", "Journal", "About"].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </nav>
        <span className="ml-auto rounded-full bg-[#c2410c] px-4 py-2 text-sm font-medium text-white">
          Book a fitting
        </span>
      </header>
      <div className="px-10 py-16 max-w-5xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#c2410c]">
          Autumn 2026
        </p>
        <h1 className="mb-6 text-6xl font-bold leading-[1.05] tracking-tight max-w-2xl">
          Clothes that outlast the season.
        </h1>
        <p className="mb-10 max-w-xl text-lg leading-relaxed text-[#6b4f3f]">
          Made in Bergen from wool we can trace to the farm. Repaired free, for
          as long as you own it.
        </p>
        <div className="grid grid-cols-3 gap-5 max-w-3xl">
          {["Knitwear", "Outerwear", "Accessories"].map((item) => (
            <div key={item}>
              <div className="mb-3 aspect-[4/5] rounded-lg bg-[#efe1d3]" />
              <p className="font-medium">{item}</p>
              <p className="text-sm text-[#6b4f3f]">From 1 490 kr</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type Story = StoryObj<typeof OverlayMenuHarness>;

const base: HarnessProps = {
  dock: "center-bottom",
  theme: "dark",
  previewMode: true,
  pendingChanges: 12,
  validationErrors: 0,
  open: null,
};

/** Preview mode: the full toolset, docked bottom centre. */
export const PreviewMode: Story = { args: base };

/** Not in preview mode: enable preview, open Studio, or turn Val off. */
export const Idle: Story = { args: { ...base, previewMode: false } };

/** Docked to a side, which turns the bar vertical. */
export const DockedRightCenter: Story = {
  args: { ...base, dock: "right-center" },
};

/** Docked bottom right — the default corner. */
export const DockedRightBottom: Story = {
  args: { ...base, dock: "right-bottom" },
};

/** Validation errors block publishing, so the count turns red. */
export const WithValidationErrors: Story = {
  args: { ...base, validationErrors: 3 },
};

/** Nothing to publish. */
export const NothingToPublish: Story = {
  args: { ...base, pendingChanges: 0 },
};

/** Light mode, over the same page. */
export const LightMode: Story = { args: { ...base, theme: "light" } };

/**
 * Select mode on: every region Val can edit is outlined on the user's page.
 *
 * The outline colour is fixed rather than themed — it is drawn on their
 * design, and a token that inverted with Val's theme would go pale on a light
 * site and muddy on a dark one.
 */
export const SelectModeOpen: Story = {
  args: { ...base, open: "select" },
};

/** A region clicked: the edit window opens over the page, next to it. */
export const EditWindowOpen: Story = {
  args: { ...base, open: "edit" },
};

/** The assistant, opened from the bar and floating over the page. */
export const ChatOpen: Story = {
  args: { ...base, open: "chat" },
};

/** The "…" button: where the bar sits, and which theme it uses. */
export const SettingsOpen: Story = {
  args: { ...base, open: "settings" },
};

/** The bar is icons only, so every button explains itself on hover. */
export const TooltipOpen: Story = {
  args: { ...base, open: "tooltip" },
};

/** The edit window in light mode, over the same page. */
export const EditWindowOpenLight: Story = {
  args: { ...base, open: "edit", theme: "light" },
};

/** The assistant in light mode. */
export const ChatOpenLight: Story = {
  args: { ...base, open: "chat", theme: "light" },
};
