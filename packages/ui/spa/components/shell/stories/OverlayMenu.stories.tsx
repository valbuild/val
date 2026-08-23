import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  Ellipsis,
  Eye,
  EyeOff,
  GitCompareArrows,
  Globe,
  MessageSquare,
  SquareDashedMousePointer,
  Upload,
  X,
} from "lucide-react";
import {
  OverlayDock,
  OverlayMenuBadge,
  OverlayMenuBar,
  OverlayMenuButton,
  OverlayMenuDivider,
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
  },
};
export default meta;

type HarnessProps = {
  dock: OverlayDock;
  theme: "dark" | "light";
  /** In preview mode the bar shows the full editing toolset. */
  previewMode: boolean;
  pendingChanges: number;
  validationErrors: number;
};

function OverlayMenuHarness({
  dock,
  theme,
  previewMode,
  pendingChanges,
  validationErrors,
}: HarnessProps) {
  const breakpoint = useShellBreakpoint();
  const compact = breakpoint === "mobile";
  const orientation = dockOrientation(dock);
  const [selectMode, setSelectMode] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: "100svh" }}
    >
      <HostPage />
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
      </div>
    </div>
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
