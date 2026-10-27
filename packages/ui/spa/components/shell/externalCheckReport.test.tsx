/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ExternalPagesDialog } from "./ExternalPagesDialog";
import { ShellExternalPage } from "./types";
import { ExternalUrlProbeResult } from "./externalUrlReachability";

/**
 * What the report says when the check itself did not run.
 *
 * The regression this guards is one the fix for a different one created: an
 * expired session was moved out of "unreachable" (which called every link
 * rotten) and into "skipped" - which the report counts as "nothing to open"
 * and therefore not a problem, so twenty unchecked URLs came back as
 * "All 20 look fine". Neither, now: unknown, and said so.
 */
function page(url: string): ShellExternalPage {
  return { id: url, name: url, url, usages: [], usagesComplete: true };
}

function renderWithProbe(urls: string[], result: ExternalUrlProbeResult) {
  render(
    <ExternalPagesDialog
      open
      onOpenChange={() => undefined}
      breakpoint="desktop"
      pages={urls.map(page)}
      onOpenEntry={() => undefined}
      onProbe={async (targets, onResult) => {
        for (const url of targets) {
          onResult(url, result);
        }
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Check/ }));
}

test("a check that could not run is never reported as fine", async () => {
  renderWithProbe(["https://a.example.com", "https://b.example.com"], {
    kind: "not-checked",
    message: "Not checked: the link check answered 401.",
  });
  expect(
    await screen.findByText(/None of these could be opened/),
  ).not.toBeNull();
  expect(screen.queryByText(/look fine/)).toBeNull();
  expect(
    screen.getByText(/Not checked: the link check answered 401\./),
  ).not.toBeNull();
});

test("a URL with nothing to open is still reported as fine", async () => {
  // The other side of the same distinction: a `mailto:` was checked as far as
  // it can be, so it does not hold the report back.
  renderWithProbe(["mailto:post@example.com"], {
    kind: "skipped",
    message: "Nothing to open: an email address is not a page.",
  });
  expect(await screen.findByText(/with nothing to open/)).not.toBeNull();
  expect(screen.queryByText(/could not be opened/)).toBeNull();
});

test("a URL that answered is reported as fine", async () => {
  renderWithProbe(["https://a.example.com"], {
    kind: "answered",
    code: 200,
    finalUrl: "https://a.example.com",
    ms: 12,
  });
  expect(await screen.findByText(/All 1 look fine\./)).not.toBeNull();
});
