import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Ellipsis, Eye, Globe, X } from "lucide-react";
import {
  OverlayCard,
  OverlayDock,
  OverlayMenuBadge,
  OverlayMenuButton,
  OverlayMenuDivider,
  OverlayMenuLauncher,
  OverlayTooltip,
} from "../OverlayMenu";
import { OverlayMenuDock } from "../OverlayMenuDock";
import { OverlaySettingsPanel } from "../OverlaySettingsPanel";
import {
  OverlayPlacement,
  placementGrowth,
  placementOfDock,
  placementOrientation,
} from "../overlayPlacement";
import { cn } from "../../designSystem/cn";
import { ValLogo } from "../ValLogo";
import { useShellBreakpoint } from "../useShellBreakpoint";
import { HostPage } from "./HostPage";

/**
 * The floating menu that sits over the user's own site.
 *
 * The mock page behind it is the point of this story: this bar is the most
 * invasive surface Val has, drawn on top of somebody else's design while they
 * are looking at their own brand. Judge it against the page, not on its own.
 *
 * Dark is the default. Drag the bar to any edge — it snaps to the nearest one
 * — or use the `dock` control for the eight presets, and resize the preview
 * to see the compact phone variant.
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
    placement: {
      control: "object",
      description:
        "Anywhere along an edge: { edge: 'left' | 'right' | 'top' | 'bottom', offset: 0..1 }. Overrides `dock`.",
    },
    theme: { control: "inline-radio", options: ["dark", "light"] },
    previewMode: { control: "boolean" },
    pendingChanges: { control: "number" },
    validationErrors: { control: "number" },
    open: {
      control: "select",
      options: [null, "settings", "tooltip"],
      description: "Which of the bar's buttons has been opened",
    },
    collapsed: {
      control: "boolean",
      description:
        "The menu at rest, as a circle. Hover or tap it to expand the pill.",
    },
  },
};
export default meta;

/** What a button opened, if anything. */
type OpenSurface = "settings" | "tooltip" | null;

type HarnessProps = {
  dock: OverlayDock;
  /**
   * Anywhere along an edge, not only the eight docks: where a drag leaves
   * it. Overrides `dock`.
   */
  placement?: OverlayPlacement;
  theme: "dark" | "light";
  /** In preview mode the bar shows the full editing toolset. */
  previewMode: boolean;
  pendingChanges: number;
  validationErrors: number;
  open: OpenSurface;
  /** Render the menu at rest rather than expanded. */
  collapsed: boolean;
};

function OverlayMenuHarness({
  dock,
  placement: placementArg,
  theme,
  previewMode,
  pendingChanges,
  validationErrors,
  open,
  collapsed,
}: HarnessProps) {
  const breakpoint = useShellBreakpoint();
  const compact = breakpoint === "mobile";
  // Dragging in the story moves the menu exactly as it does on a page.
  const initialPlacement = placementArg ?? placementOfDock(dock);
  const [placement, setPlacement] = useState(initialPlacement);
  useEffect(
    () => setPlacement(placementArg ?? placementOfDock(dock)),
    // The object arg is a new object on every render; its fields are not.
    [dock, placementArg?.edge, placementArg?.offset],
  );
  // The "⋯" panel switches the theme, as it does on a page.
  const [currentTheme, setCurrentTheme] = useState(theme);
  useEffect(() => setCurrentTheme(theme), [theme]);
  const orientation = placementOrientation(placement);
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: "100svh" }}
    >
      <HostPage />
      <OverlayMenuDock
        placement={placement}
        onPlacementChange={setPlacement}
        className="z-50"
      >
        {({ dragging }) => (
          <div data-mode={currentTheme} className="relative">
            <OverlayMenuLauncher
              key={String(collapsed)}
              placement={placement}
              dragging={dragging}
              compact={compact}
              defaultExpanded={!collapsed}
              // As the overlay does while its "⋯" menu is open.
              holdOpen={open === "settings"}
              status={validationErrors > 0 ? "errors" : "changes"}
              mark={<ValLogo className="h-6" />}
            >
              {!previewMode && (
                <OverlayMenuButton
                  label="Enable preview mode"
                  compact={compact}
                  icon={<Eye size={16} />}
                />
              )}
              <div className="relative inline-flex">
                <OverlayMenuButton
                  label="Open in Studio"
                  compact={compact}
                  icon={<Globe size={16} />}
                />
                <OverlayMenuBadge
                  count={
                    validationErrors > 0 ? validationErrors : pendingChanges
                  }
                  tone={validationErrors > 0 ? "error" : "neutral"}
                />
              </div>
              <OverlayMenuButton
                label="More"
                compact={compact}
                active={open === "settings"}
                icon={<Ellipsis size={16} />}
              />
              <OverlayMenuDivider orientation={orientation} />
              <OverlayMenuButton
                label="Turn off Val on this site"
                compact={compact}
                icon={<X size={16} />}
              />
            </OverlayMenuLauncher>
            {open === "settings" && (
              <OverlayCard
                className={cn("absolute w-60 p-1.5", besideBar(placement))}
              >
                <OverlaySettingsPanel
                  placement={placement}
                  onPlacementChange={setPlacement}
                  dark={currentTheme === "dark"}
                  onDarkChange={(dark) =>
                    setCurrentTheme(dark ? "dark" : "light")
                  }
                  inPreview={previewMode}
                  onExitPreview={() => {}}
                />
              </OverlayCard>
            )}
            {open === "tooltip" && (
              <OverlayTooltip className={cn("absolute", besideBar(placement))}>
                Turn off Val on this site
              </OverlayTooltip>
            )}
          </div>
        )}
      </OverlayMenuDock>
    </div>
  );
}

/**
 * Where something opened from the bar sits: off its page-facing side, lined
 * up with the end the bar grows from. The overlay gets the same from Radix's
 * `side`; the story has no popover to ask.
 */
function besideBar(placement: OverlayPlacement): string {
  const growth = placementGrowth(placement);
  const vertical = placement.edge === "left" || placement.edge === "right";
  const across = {
    left: "left-full ml-3",
    right: "right-full mr-3",
    top: "top-full mt-3",
    bottom: "bottom-full mb-3",
  }[placement.edge];
  const along = vertical
    ? growth === "centre"
      ? "top-1/2 -translate-y-1/2"
      : growth === "forward"
        ? "top-0"
        : "bottom-0"
    : growth === "centre"
      ? "left-1/2 -translate-x-1/2"
      : growth === "forward"
        ? "left-0"
        : "right-0";
  return `${across} ${along}`;
}

type Story = StoryObj<typeof OverlayMenuHarness>;

const base: HarnessProps = {
  dock: "center-bottom",
  theme: "dark",
  previewMode: true,
  pendingChanges: 12,
  validationErrors: 0,
  open: null,
  collapsed: false,
};

/** Preview mode: the full toolset, docked bottom centre. */
export const PreviewMode: Story = { args: base };

/** Not in preview mode: enable preview, open Studio, or "⋯". */
export const Idle: Story = { args: { ...base, previewMode: false } };

/** Docked to a side, which turns the bar vertical. */
export const DockedRightCenter: Story = {
  args: { ...base, dock: "right-center" },
};

/** Docked bottom right. */
export const DockedRightBottom: Story = {
  args: { ...base, dock: "right-bottom" },
};

/**
 * Drag it anywhere. Every story here can be dragged, with a mouse or a
 * finger: let go and it snaps to the nearest edge, as far along it as it was
 * left, and to the exact middle when dropped near the middle.
 *
 * This one starts collapsed, which is how it is usually picked up.
 */
export const DragAndSnap: Story = {
  args: { ...base, collapsed: true, dock: "right-bottom" },
};

/**
 * Left where a drag left it: a third of the way down the left edge. It grows
 * down, away from the nearer end.
 */
export const LeftEdge: Story = {
  args: { ...base, placement: { edge: "left", offset: 0.3 } },
};

/** Low on the right edge it grows UP, so it does not run off the bottom. */
export const RightEdgeGrowingUp: Story = {
  args: { ...base, placement: { edge: "right", offset: 0.8 } },
};

/** In the middle of the top edge it grows both ways, centred. */
export const TopCentre: Story = {
  args: { ...base, dock: "center-top" },
};

/** A third of the way along the bottom: not a preset, just where it was put. */
export const BottomEdgeAnywhere: Story = {
  args: { ...base, placement: { edge: "bottom", offset: 0.3 } },
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
 * The "⋯" button: where the bar sits, light or dark, and the two ways out.
 *
 * This is the real panel. Pick a position and the bar moves there; flip the
 * switch and the whole overlay changes theme.
 */
export const SettingsOpen: Story = {
  args: { ...base, open: "settings" },
};

/** The same panel in light mode. */
export const SettingsOpenLight: Story = {
  args: { ...base, open: "settings", theme: "light" },
};

/**
 * Out of preview mode there is no preview to leave, so the panel offers only
 * hiding Val.
 */
export const SettingsOpenIdle: Story = {
  args: { ...base, open: "settings", previewMode: false },
};

/** Opened from a bar on a side edge: the panel opens toward the page. */
export const SettingsOpenOnSide: Story = {
  args: { ...base, open: "settings", dock: "right-center" },
};

/** The bar is icons only, so every button explains itself on hover. */
export const TooltipOpen: Story = {
  args: { ...base, open: "tooltip" },
};

/**
 * The menu at rest: a circle, and nothing else.
 *
 * This is what a customer's page carries almost all of the time, so it is the
 * state that matters most. The dot says there is unpublished work, so the
 * circle does not have to be opened to find that out.
 */
export const Collapsed: Story = {
  args: { ...base, collapsed: true },
};

/** Collapsed with validation errors: the dot turns red. */
export const CollapsedWithErrors: Story = {
  args: { ...base, collapsed: true, validationErrors: 3 },
};

/** Collapsed against a side dock, where it expands vertically. */
export const CollapsedRightCenter: Story = {
  args: { ...base, collapsed: true, dock: "right-center" },
};

/** Collapsed in light mode. */
export const CollapsedLight: Story = {
  args: { ...base, collapsed: true, theme: "light" },
};
