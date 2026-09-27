/** @jest-environment jsdom */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExternalPagesDialog } from "./ExternalPagesDialog";
import { ShellExternalPage } from "./types";

/**
 * What happens to the list when a URL is added.
 *
 * The add itself always worked; what did not was seeing it. A new key is
 * sorted into a list of two dozen by a grouping nobody was thinking about
 * while they typed it, so it landed off screen and the dialog looked like it
 * had done nothing. So the add has to leave the new row visible and open.
 */
function page(url: string): ShellExternalPage {
  return { id: url, name: url, url, usages: [], usagesComplete: true };
}

/**
 * The dialog with a store behind it, because the thing under test spans the
 * round trip: the entry does not exist on the render that adds it.
 */
function Harness({ initial }: { initial: string[] }) {
  const [urls, setUrls] = useState(initial);
  return (
    <ExternalPagesDialog
      open
      onOpenChange={() => undefined}
      breakpoint="desktop"
      pages={urls.map(page)}
      onOpenEntry={() => undefined}
      onAddPage={(url) => setUrls((prev) => [...prev, url])}
    />
  );
}

/** jsdom has no layout, so it has no `scrollIntoView` either. */
const scrollIntoView = jest.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

/**
 * Add a URL through the toolbar, the way an editor does.
 *
 * `fireEvent` rather than `user-event`: the latter is not a dependency of this
 * package, and nothing here needs the pointer sequence it simulates.
 */
function addUrl(url: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

test("the URL that was just added is the one the detail pane is showing", () => {
  render(
    <Harness initial={["https://a.example.com", "https://z.example.com"]} />,
  );
  addUrl("https://m.example.com/new");

  // Grouped by domain, so a row is labelled with what the heading above it
  // does not already say.
  const row = screen.getByRole("button", { name: "m.example.com/new" });
  expect(row.getAttribute("aria-current")).toBe("true");
  // The detail pane's own copy of the URL, which is what says the pane is
  // showing this entry rather than the placeholder.
  expect(
    screen.getByRole("link", {
      name: "Open https://m.example.com/new in a new tab",
    }),
  ).not.toBeNull();
});

test("a filter that would hide the new row is cleared by adding it", () => {
  render(<Harness initial={["https://a.example.com"]} />);
  fireEvent.change(screen.getByPlaceholderText("Filter URLs…"), {
    target: { value: "zzz" },
  });
  expect(screen.queryByRole("button", { name: "a.example.com" })).toBeNull();

  addUrl("https://m.example.com/new");
  expect(
    screen.getByRole("button", { name: "m.example.com/new" }),
  ).not.toBeNull();
});

test("the new row is scrolled to once, and not again on later renders", () => {
  render(<Harness initial={["https://a.example.com"]} />);
  addUrl("https://m.example.com/new");
  expect(scrollIntoView).toHaveBeenCalledTimes(1);

  // Anything that re-renders the list must not drag it back.
  fireEvent.click(screen.getByRole("button", { name: "a.example.com" }));
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});
