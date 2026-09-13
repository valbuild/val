import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { ExternalPagesDialog } from "../ExternalPagesDialog";
import { ExternalPagesButton } from "../ExternalPagesButton";
import { PagesPanel } from "../PagesPanel";
import { Button } from "../../designSystem/button";
import { ShellBreakpoint, ShellExternalPage } from "../types";
import { mockExternalPages, mockPages, mockShellData } from "../mockShellData";
import { fn } from "storybook/test";
import { useValPortal } from "../../ValPortalProvider";
import { checkExternalUrls, statusOf } from "../externalUrlChecks";

/**
 * Every URL outside the site, in one dialog.
 *
 * The redesign starts from what the data is. The external router is a record
 * whose KEYS are absolute URLs - there is no title, no tree, no route, nothing
 * to sort by that a person chose. So the list is a list of URLs, and everything
 * on a row is either derived from the URL itself or is one of the two facts a
 * URL cannot show:
 *
 *  - **where it is used**, from a route reference scan. A link nothing points
 *    at is the one you can delete; a link twenty things point at is the one you
 *    cannot rename casually. Both are invisible in the list this replaces.
 *  - **whether anything is wrong with it**, from checks over the URL string and
 *    the URLs beside it - a key the router will refuse, a password pasted into
 *    content, the same page listed twice, a localhost URL added from someone's
 *    laptop. Nothing here opens a connection, so a link that has gone dead
 *    still looks fine; that is deliberate, and the report says so.
 *
 * Grouping is by registrable domain, which is what turns eighteen strangers
 * into seven clusters you recognise. Toggle it off to see why: `Flat` is the
 * same list without the one bit of structure the URLs carry.
 *
 * Try: **Check** with nothing selected (checks everything visible), then tick
 * two rows and press it again. Filter to `Unused`. Open a row to see the
 * entry's own value and the places that link to it.
 */
const meta: Meta<typeof DialogHarness> = {
  title: "Shell/ExternalPages",
  component: DialogHarness,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  argTypes: {
    breakpoint: {
      control: "inline-radio",
      options: ["mobile", "tablet", "desktop"],
      description:
        "Below `tablet` the dialog shows one pane at a time, list first.",
    },
    canWrite: {
      control: "boolean",
      description: "Whether the app can add and remove URLs in this mode.",
    },
    isLoading: { control: "boolean" },
    pageCount: {
      control: { type: "range", min: 0, max: 18, step: 1 },
      description: "How many of the mock URLs the project has.",
    },
  },
  args: {
    breakpoint: "desktop",
    canWrite: true,
    isLoading: false,
    pageCount: mockExternalPages.length,
  },
};

export default meta;

type HarnessProps = {
  breakpoint: ShellBreakpoint;
  canWrite: boolean;
  isLoading: boolean;
  pageCount: number;
};

function DialogHarness({
  breakpoint,
  canWrite,
  isLoading,
  pageCount,
}: HarnessProps) {
  const portalContainer = useValPortal();
  const [open, setOpen] = useState(true);
  // Removal is tracked as a set of URLs rather than a copy of the list, so the
  // `pageCount` control keeps working after something has been removed.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const pages: ShellExternalPage[] = useMemo(
    () =>
      mockExternalPages
        .slice(0, pageCount)
        .filter((page) => !removed.has(page.url)),
    [pageCount, removed],
  );
  return (
    <div className="w-full h-screen grid place-items-center bg-bg-canvas">
      {!open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open external pages
        </Button>
      )}
      <ExternalPagesDialog
        open={open}
        onOpenChange={setOpen}
        breakpoint={breakpoint}
        pages={pages}
        portalContainer={portalContainer}
        isLoading={isLoading}
        onOpenEntry={fn()}
        onOpenUsage={fn()}
        onAddPage={canWrite ? fn() : undefined}
        onRemovePage={
          canWrite
            ? (page) => setRemoved((prev) => new Set([...prev, page.url]))
            : undefined
        }
      />
    </div>
  );
}

type Story = StoryObj<typeof DialogHarness>;

/** The whole thing, with a project's worth of URLs behind it. */
export const Dialog: Story = {};

/**
 * A project that has never added one.
 *
 * The empty state has to say what an external page IS, because the only people
 * who see it are the ones who have not met the idea yet.
 */
export const Empty: Story = { args: { pageCount: 0 } };

/** Enough URLs to need grouping, but not enough to scroll. */
export const AFewUrls: Story = { args: { pageCount: 5 } };

/** While the record and the reference scan are still coming back. */
export const Loading: Story = { args: { isLoading: true } };

/**
 * A mode that cannot write: no Add, no Remove.
 *
 * Everything else stays - reading which links exist, what is behind them and
 * where they are used is exactly as useful without an edit button.
 */
export const ReadOnly: Story = { args: { canWrite: false } };

/**
 * On a phone the panes take turns.
 *
 * Resize the preview below 768px as well - the dialog's own grid collapses at
 * `md`, and the `breakpoint` arg is what decides which pane is showing.
 */
export const Mobile: Story = {
  args: { breakpoint: "mobile" },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/**
 * The button that replaces the list, in the panel it replaces it in.
 *
 * External pages were a second section under the site map: two dozen flat rows
 * that pushed the site map out of view and answered none of the questions
 * anyone opens them with. Now the panel's footer says how many there are and
 * how many want looking at, and the dialog answers the rest.
 *
 * The button is live - press it.
 */
export const InThePagesPanel: StoryObj<typeof PagesPanelHarness> = {
  render: (args) => <PagesPanelHarness {...args} />,
  args: {
    breakpoint: "desktop",
    canWrite: true,
    isLoading: false,
    pageCount: mockExternalPages.length,
  },
};

function PagesPanelHarness({ breakpoint, canWrite, pageCount }: HarnessProps) {
  const portalContainer = useValPortal();
  const [open, setOpen] = useState(false);
  const pages = useMemo(
    () => mockExternalPages.slice(0, pageCount),
    [pageCount],
  );
  const issueCount = useMemo(() => {
    const issues = checkExternalUrls(pages.map((page) => page.url));
    return pages.filter((page) => statusOf(issues.get(page.url) ?? []) !== "ok")
      .length;
  }, [pages]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div className="relative w-full h-screen bg-bg-canvas overflow-hidden">
      <PagesPanel
        breakpoint={breakpoint}
        pages={mockPages}
        externalPages={pages}
        selectedId={selectedId}
        onSelectPage={(page) => setSelectedId(page.id)}
        onSelectExternalPage={(page) => setSelectedId(page.id)}
        onOpenExternalPages={() => setOpen(true)}
        externalIssueCount={issueCount}
        onNewPage={fn()}
        newPage={mockShellData.newPage}
        onClose={() => undefined}
      />
      <ExternalPagesDialog
        open={open}
        onOpenChange={setOpen}
        breakpoint={breakpoint}
        pages={pages}
        portalContainer={portalContainer}
        onOpenEntry={(page) => setSelectedId(page.id)}
        onOpenUsage={fn()}
        onAddPage={canWrite ? fn() : undefined}
      />
    </div>
  );
}

/**
 * The button on its own, in every state it has.
 *
 * It carries a count and, when something is flagged, a second one - because a
 * collapsed section that says nothing about what is inside it is a section
 * nobody opens.
 */
export const TheButton: StoryObj<typeof ExternalPagesButton> = {
  render: () => (
    <div className="w-[18rem] p-3 space-y-1 bg-bg-float border border-border-float rounded-lg">
      <ExternalPagesButton
        count={18}
        issueCount={6}
        onClick={() => undefined}
      />
      <ExternalPagesButton count={18} onClick={() => undefined} />
      <ExternalPagesButton count={0} onClick={() => undefined} />
    </div>
  ),
  parameters: { layout: "centered" },
};
