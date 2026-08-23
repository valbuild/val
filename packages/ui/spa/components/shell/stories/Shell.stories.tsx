import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Shell } from "../Shell";
import { ShellPanel } from "../types";
import { emptyShellData, mockShellData } from "../mockShellData";

/**
 * The whole shell in one story.
 *
 * Everything is interactive: the rail, the menu button, the top bar buttons
 * and the panel close buttons all work, so a single story is enough to check
 * every layout state. Resize the preview to cross the breakpoints — the shell
 * reads the viewport, so mobile chrome appears below 768px and the left rail
 * appears at 1200px.
 *
 * Dark mode is the default. Switch it from the toolbar, or from the shell's
 * own Settings panel.
 */
const meta: Meta<typeof ShellHarness> = {
  title: "Shell/Shell",
  component: ShellHarness,
  parameters: {
    layout: "fullscreen",
    // The shell paints its own canvas and owns the full viewport.
    backgrounds: { disable: true },
  },
  argTypes: {
    openPanel: {
      control: "select",
      options: [
        null,
        "pages",
        "media",
        "data",
        "settings",
        "utility",
        "ai",
        "notifications",
      ],
      description: "Panel to open on mount",
    },
    selectionId: {
      control: "select",
      options: [null, "home", "pricing", "data-products", "ext-ig"],
      description: "Item selected in the editor on mount",
    },
    empty: {
      control: "boolean",
      description: "Render an empty project to check empty states",
    },
    searchOpen: {
      control: "boolean",
      description: "Open the global search on mount (⌘K / Ctrl+K)",
    },
  },
};
export default meta;

type HarnessProps = {
  openPanel: ShellPanel | null;
  selectionId: string | null;
  empty: boolean;
  searchOpen: boolean;
  theme: "dark" | "light";
};

/**
 * Owns the theme so the Settings panel's own theme switch works inside the
 * story, and keys the shell on the mount-time args so changing a control
 * remounts it into that state.
 */
function ShellHarness({
  openPanel,
  selectionId,
  empty,
  searchOpen,
  theme,
}: HarnessProps) {
  const [currentTheme, setCurrentTheme] = useState<"dark" | "light">(theme);
  return (
    <Shell
      key={`${openPanel}-${selectionId}-${empty}-${searchOpen}`}
      data={empty ? emptyShellData : mockShellData}
      initialPanel={openPanel}
      initialSelectionId={selectionId}
      initialSearchOpen={searchOpen}
      theme={currentTheme}
      onThemeChange={setCurrentTheme}
      pendingChanges={empty ? 0 : 12}
    />
  );
}

type Story = StoryObj<typeof ShellHarness>;

/** Nothing open: the resting state, and where the empty editor shows. */
export const Default: Story = {
  args: {
    openPanel: null,
    selectionId: null,
    empty: false,
    searchOpen: false,
    theme: "dark",
  },
};

/** A page open in the editor, no chrome in the way. */
export const EditingAPage: Story = {
  args: { ...Default.args, selectionId: "home" },
};

/**
 * The Pages panel: the site map first, external pages at the end of the same
 * list. Both are pages as far as an editor is concerned.
 */
export const PagesPanelOpen: Story = {
  args: { ...Default.args, openPanel: "pages", selectionId: "home" },
};

/** Media galleries, by directory. */
export const MediaPanelOpen: Story = {
  args: { ...Default.args, openPanel: "media", selectionId: "home" },
};

/** Non-router val modules. */
export const DataPanelOpen: Story = {
  args: { ...Default.args, openPanel: "data", selectionId: "data-products" },
};

/** The narrow right utility panel: quick actions and recent activity. */
export const UtilityPanelOpen: Story = {
  args: { ...Default.args, openPanel: "utility", selectionId: "home" },
};

/** The assistant, floating over the editor rather than resizing it. */
export const AIChatOpen: Story = {
  args: { ...Default.args, openPanel: "ai", selectionId: "home" },
};

/** The notification centre. */
export const NotificationsOpen: Story = {
  args: { ...Default.args, openPanel: "notifications", selectionId: "home" },
};

/** Account and workspace settings — and, on mobile, the status controls. */
export const SettingsOpen: Story = {
  args: { ...Default.args, openPanel: "settings", selectionId: "home" },
};

/**
 * Global search: ⌘K / Ctrl+K from anywhere, or the top bar's search button.
 * Distinct from a panel's filter, which only narrows the list in front of you.
 */
export const GlobalSearchOpen: Story = {
  args: { ...Default.args, searchOpen: true, selectionId: "home" },
};

/** Light mode. Dark is the default, but both are first-class. */
export const LightMode: Story = {
  args: {
    ...Default.args,
    theme: "light",
    openPanel: "pages",
    selectionId: "home",
  },
};

/** A brand new project: every list empty, nothing to publish. */
export const EmptyProject: Story = {
  args: { ...Default.args, empty: true, openPanel: "pages" },
};
