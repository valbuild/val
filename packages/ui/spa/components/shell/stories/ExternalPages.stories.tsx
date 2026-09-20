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
import { createBatchedProber, ProbeBatch } from "../externalUrlProber";
import { ExternalUrlProbeResult } from "../externalUrlReachability";

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
 * **Check** is the half that needs the network, and a mock server answers it
 * here. Press it with nothing selected to check everything visible, and watch
 * the counter: URLs go up in batches of four (ten in the real one), so a
 * project with a thousand links never becomes a thousand simultaneous requests
 * out of the app's server. `val.substack.com` answers 503 twice before it
 * answers 200, so it is the row that lags and then comes back fine - that is
 * the retry, three attempts with a doubling backoff. **Stop** is the same
 * button while it runs, and rows that never got an answer go back to unchecked
 * rather than sitting on a spinner forever.
 *
 * The report it produces is the FINDINGS, not a transcript: the clean rows
 * are a number, and each flagged one gets a single line with the worst thing
 * found. Press Check on `AFewUrls` to see the other half of that - "All 5
 * look fine" is the answer a check button exists to give, and it is one line.
 *
 * Try: Check everything, then tick two rows and press it again. Filter to
 * `Flagged` once the answers are in, or to `Unused`. Open a row to see the
 * entry's own value, every finding rather than the first, what answered, and
 * the places that link to it.
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
      control: { type: "range", min: 0, max: 20, step: 1 },
      description: "How many of the mock URLs the project has.",
    },
    canProbe: {
      control: "boolean",
      description:
        "Whether the app can open the URLs. Off, Check reports the shape findings alone.",
    },
    httpsOnly: {
      control: "boolean",
      description:
        'Whether the project narrowed its router to `externalPageRouter({ schemes: ["https"] })`. On, the mailto: and tel: keys become errors and Add refuses them.',
    },
  },
  args: {
    breakpoint: "desktop",
    canWrite: true,
    isLoading: false,
    pageCount: mockExternalPages.length,
    canProbe: true,
    httpsOnly: false,
  },
};

export default meta;

type HarnessProps = {
  breakpoint: ShellBreakpoint;
  canWrite: boolean;
  isLoading: boolean;
  pageCount: number;
  canProbe: boolean;
  httpsOnly: boolean;
};

/** What `externalPageRouter({ schemes })` serializes to, for the harness. */
const HTTPS_ONLY: readonly string[] = ["https"];

const answered = (
  code: number,
  finalUrl: string,
  ms = 120,
): ExternalUrlProbeResult => ({ kind: "answered", code, finalUrl, ms });

/**
 * What the mock server says about each URL.
 *
 * One of everything the report has to render, and two of the ones that are
 * easy to get wrong: a redirect that still works (the link has moved, which is
 * a finding), and a 403 that means "not from here" rather than "broken".
 */
function scriptedAnswer(url: string, attempt: number): ExternalUrlProbeResult {
  switch (url) {
    case "https://status.example.com":
      return answered(404, url);
    case "http://status.example.com":
      return answered(301, "https://status.example.com");
    case "https://x.com/valbuild":
      return answered(301, "https://twitter.com/valbuild");
    case "https://jobs.example.com/val":
      return answered(403, url);
    case "https://youtube.com/@valbuild":
      return { kind: "timeout", ms: 5000 };
    case "http://localhost:3000/preview":
      return { kind: "unreachable", message: "connection refused" };
    case "http://admin:hunter2@legacy.example.com/reports":
      return { kind: "unreachable", message: "getaddrinfo ENOTFOUND" };
    case "https://val.substack.com":
      // Fails twice, then answers — the retry, visible as a row that takes
      // longer than its neighbours and then comes back fine.
      return attempt < 3 ? answered(503, url) : answered(200, url, 640);
    default:
      return answered(200, url, 90 + (url.length % 200));
  }
}

/**
 * A server that answers slowly enough to watch.
 *
 * Real batches are ten URLs to one request; this is four, so the progress
 * counter moves several times in a story you can actually sit through.
 */
function mockProbeBatch(delayMs: number): ProbeBatch {
  const attempts = new Map<string, number>();
  return async (urls, signal) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const results = new Map<string, ExternalUrlProbeResult>();
    if (signal.aborted) return results;
    for (const url of urls) {
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      results.set(url, scriptedAnswer(url, attempt));
    }
    return results;
  };
}

function useMockProber(enabled: boolean) {
  return useMemo(
    () =>
      enabled
        ? createBatchedProber(mockProbeBatch(450), {
            batchSize: 4,
            attempts: 3,
            backoffMs: 300,
          })
        : undefined,
    [enabled],
  );
}

function DialogHarness({
  breakpoint,
  canWrite,
  isLoading,
  pageCount,
  canProbe,
  httpsOnly,
}: HarnessProps) {
  const portalContainer = useValPortal();
  const onProbe = useMockProber(canProbe);
  const [open, setOpen] = useState(true);
  // Removal is tracked as a set of URLs rather than a copy of the list, so the
  // `pageCount` control keeps working after something has been removed.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  // Added URLs get the shape a real one has: no fields yet, and nothing
  // linking to it — which is exactly what a just-created entry looks like.
  const [added, setAdded] = useState<readonly string[]>([]);
  const pages: ShellExternalPage[] = useMemo(
    () =>
      mockExternalPages
        .slice(0, pageCount)
        .concat(
          added.map((url) => ({
            id: url,
            name: url,
            url,
            fields: [],
            usages: [],
            usagesComplete: true,
          })),
        )
        .filter((page) => !removed.has(page.url)),
    [pageCount, removed, added],
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
        onProbe={onProbe}
        schemes={httpsOnly ? HTTPS_ONLY : undefined}
        isLoading={isLoading}
        onOpenEntry={fn()}
        onOpenUsage={fn()}
        onAddPage={
          canWrite ? (url) => setAdded((prev) => [...prev, url]) : undefined
        }
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
 * The app has no way to open the URLs.
 *
 * Check still works and still reports - on the shape findings alone, and the
 * report says so rather than implying the links were opened and are fine.
 */
export const WithoutLinkChecking: Story = { args: { canProbe: false } };

/**
 * A link is not only a web page.
 *
 * `mailto:` and `tel:` are ordinary keys under the default policy, which is a
 * deny list rather than an allow list: anything with a scheme, except the
 * handful that are not links at all (`javascript:`, `data:`). The list treats
 * them as what they are - the mailto groups under `example.com` beside that
 * domain's web pages, because the heading names the organisation, and the
 * phone number gets a heading of its own.
 *
 * Press Check: neither can be opened, and the report says there is nothing to
 * open rather than calling them unreachable. Scroll to `Phone numbers` and
 * `example.com` to see both.
 */
export const OtherSchemes: Story = {};

/**
 * A project that narrowed its router: `externalPageRouter({ schemes: ["https"] })`.
 *
 * The same rule the server enforces, applied while the key is being typed. The
 * `mailto:` and `tel:` rows are now errors with the router's own wording, and
 * Add refuses the same keys in the same words - one `rejectScheme`, called
 * from both sides.
 */
export const NarrowedToHttps: Story = { args: { httpsOnly: true } };

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
    canProbe: true,
    httpsOnly: false,
  },
};

function PagesPanelHarness({
  breakpoint,
  canWrite,
  pageCount,
  canProbe,
}: HarnessProps) {
  const portalContainer = useValPortal();
  const onProbe = useMockProber(canProbe);
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
        onProbe={onProbe}
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
