import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import type { DependencyChange } from "@valbuild/shared/internal";
import { Shell } from "../Shell";
import { ShellPanel } from "../types";
import { mockSelectionIds, mockShellData } from "../mockShellData";
import { SiteUpdateDialog } from "../SiteUpdateDialog";
import type { SiteUpdateView } from "../../../publish/useSiteUpdate";

/**
 * A site update, from the badge to the reload.
 *
 * The badge is on Quick actions (the top bar's panel button, and the phone
 * bar's), Show updates is the first row in that panel, and it opens the
 * dialog. Update site runs a simulated update through the three steps and
 * ends live; set the viewport to a phone to see the sheet.
 */
const meta: Meta<typeof SiteUpdateHarness> = {
  title: "Shell/Site update",
  component: SiteUpdateHarness,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  argTypes: {
    start: {
      control: "select",
      options: ["available", "updating", "blocked", "failed", "updated"],
    },
    openPanel: { control: "select", options: [null, "utility"] },
  },
};
export default meta;

const changes: DependencyChange[] = [
  ["@valbuild/core", "0.142.0", "0.145.0"],
  ["@valbuild/react", "0.142.0", "0.145.0"],
  ["@valbuild/tanstack", "0.142.0", "0.145.0"],
  ["@tanstack/react-router", "1.170.2", "1.170.41"],
  ["@tanstack/react-start", "1.168.50", "1.168.60"],
  ["react", "19.2.6", "19.2.8"],
  ["react-dom", "19.2.6", "19.2.8"],
  ["zod", "3.24.1", "4.1.0"],
  ["clsx", "2.1.0", "2.1.1"],
  ["tailwind-merge", "3.2.0", "3.3.1"],
]
  .map(
    ([name, from, to]): DependencyChange => ({
      name,
      section: "dependencies",
      from,
      to,
    }),
  )
  .concat([
    {
      name: "typescript",
      section: "devDependencies",
      from: "5.8.3",
      to: "5.9.2",
    },
    {
      name: "@valbuild/cli",
      section: "devDependencies",
      from: "0.142.0",
      to: "0.145.0",
    },
  ]);

type Start = "available" | "updating" | "blocked" | "failed" | "updated";

function initialView(start: Start): SiteUpdateView {
  switch (start) {
    case "available":
      return { status: "available", changes };
    case "updating":
      return {
        status: "updating",
        step: "Checking the site renders",
        percent: 70,
        stage: "checking",
      };
    case "blocked":
      return { status: "blocked" };
    case "failed":
      return {
        status: "failed",
        message: "The updated site did not pass its check.",
        details:
          "GET / → 500\nTypeError: Cannot read properties of undefined (reading 'map')\n    at getRouter (server.js:1:4211)",
      };
    case "updated":
      return { status: "updated", changes };
  }
}

/** Rebuild, check, go live: what `useSiteUpdate` reports, on a timer. */
const SIMULATED: SiteUpdateView[] = [
  {
    status: "updating",
    step: "Loading the builder",
    percent: 0,
    stage: "rebuilding",
  },
  { status: "updating", step: "Building", percent: 12, stage: "rebuilding" },
  {
    status: "updating",
    step: "Uploading 3 of 8",
    percent: 50,
    stage: "rebuilding",
  },
  {
    status: "updating",
    step: "Checking the site renders",
    percent: 64,
    stage: "checking",
  },
  { status: "updating", step: "Going live", percent: 86, stage: "going-live" },
  { status: "updated", changes },
];

function SiteUpdateHarness({
  start,
  openPanel,
  buildsInNewTab,
  pendingChanges,
}: {
  start: Start;
  openPanel: ShellPanel | null;
  buildsInNewTab: boolean;
  pendingChanges: number;
}) {
  const [view, setView] = useState<SiteUpdateView>(initialView(start));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    setView(initialView(start));
  }, [start]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const update = () => {
    timers.current.forEach(clearTimeout);
    timers.current = SIMULATED.map((next, index) =>
      setTimeout(() => setView(next), 300 + index * 1200),
    );
    setView({ status: "updating", step: "Starting the update" });
  };
  return (
    <Shell
      key={`${start}-${openPanel}`}
      data={{ ...mockShellData, studioIsDeployer: true }}
      theme="dark"
      onThemeChange={() => undefined}
      initialPanel={openPanel}
      initialSelectionId={mockSelectionIds.home}
      aiEnabled
      pendingChanges={pendingChanges}
      onCompare={() => undefined}
      siteUpdate={{
        view,
        buildsInNewTab,
        onUpdate: update,
        onRetry: () => setView({ status: "available", changes }),
        onReload: () => setView({ status: "current" }),
        onOpenBuilderTab: () =>
          setView({
            status: "updating",
            step: "Opening a tab to build the site",
          }),
      }}
    />
  );
}

type Story = StoryObj<typeof SiteUpdateHarness>;

/** The badge on Quick actions, before anyone has opened anything. */
export const Available: Story = {
  args: {
    start: "available",
    openPanel: null,
    buildsInNewTab: false,
    pendingChanges: 3,
  },
};

/** Quick actions open: Show updates first, with the same badge. */
export const QuickActionsOpen: Story = {
  args: { ...Available.args, openPanel: "utility" },
};

/** As an iPhone sees it: the update builds in a tab of its own. */
export const InANewTab: Story = {
  args: { ...Available.args, openPanel: "utility", buildsInNewTab: true },
};

export const Updating: Story = {
  args: { ...Available.args, start: "updating", openPanel: "utility" },
};

export const Failed: Story = {
  args: { ...Available.args, start: "failed", openPanel: "utility" },
};

export const Updated: Story = {
  args: { ...Available.args, start: "updated", openPanel: "utility" },
};

/**
 * The dialog on its own, in each state, without the shell around it: the
 * quickest way to read every sentence it can say.
 */
export const DialogStates: StoryObj<{
  start: Start;
  breakpoint: "desktop" | "mobile";
  buildsInNewTab: boolean;
  pendingChanges: number;
}> = {
  args: {
    start: "available",
    breakpoint: "desktop",
    buildsInNewTab: false,
    pendingChanges: 3,
  },
  argTypes: {
    start: {
      control: "select",
      options: ["available", "updating", "blocked", "failed", "updated"],
    },
    breakpoint: { control: "select", options: ["desktop", "mobile"] },
  },
  render: ({ start, breakpoint, buildsInNewTab, pendingChanges }) => (
    <div data-mode="dark" className="min-h-screen bg-bg-primary">
      <SiteUpdateDialog
        view={initialView(start)}
        breakpoint={breakpoint}
        buildsInNewTab={buildsInNewTab}
        pendingChanges={pendingChanges}
        onUpdate={() => undefined}
        onRetry={() => undefined}
        onReload={() => undefined}
        onOpenBuilderTab={() => undefined}
        onClose={() => undefined}
      />
    </div>
  ),
};
