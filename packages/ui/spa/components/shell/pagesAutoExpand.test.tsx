/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { PagesPanel } from "./PagesPanel";
import type { ShellPage } from "./types";

/**
 * Whether the site map arrives open.
 *
 * On any project with a home page at `/`, `toShellPages` nests the ENTIRE site
 * under that one root row — so a panel that starts with nothing expanded is a
 * panel called Pages showing a single row called Home. That is a large part of
 * "it is hard to find stuff": the site was there, one chevron away, and nothing
 * said so.
 *
 * The old rule still holds for a site map that does not fit — see `SMALL_SITE`.
 */
const child = (id: string): ShellPage => ({
  id,
  name: id,
  urlPath: id,
  sourcePath: `/app/page.val.ts?p="${id}"`,
  isTracked: true,
});

const site = (count: number): ShellPage[] => [
  {
    id: "/",
    name: "Home",
    urlPath: "/",
    sourcePath: '/app/page.val.ts?p="/"',
    isTracked: true,
    children: Array.from({ length: count }, (_, i) => child(`/page-${i}`)),
  },
];

function panel(pages: ShellPage[]) {
  return (
    <PagesPanel
      breakpoint="desktop"
      pages={pages}
      externalPages={[]}
      selectedId={null}
      onSelectPage={() => undefined}
      onNewPage={() => undefined}
      onClose={() => undefined}
    />
  );
}

describe("the site map's opening state", () => {
  test("a small site is open, so the pages are visible", () => {
    render(panel(site(4)));
    expect(screen.queryByText("/page-0")).not.toBeNull();
    expect(screen.queryByText("/page-3")).not.toBeNull();
  });

  // Past the point where opening everything reveals more than it buries, the
  // original rule applies: the tree is a tree, and you open what you want.
  test("a large site stays closed", () => {
    render(panel(site(40)));
    expect(screen.queryByText("/page-0")).toBeNull();
    expect(screen.queryByText("Home")).not.toBeNull();
  });

  test("collapsing a row that opened itself sticks", () => {
    const pages = site(4);
    const { rerender } = render(panel(pages));
    fireEvent.click(screen.getByText("Home"));
    expect(screen.queryByText("/page-0")).toBeNull();
    // A re-render with the same pages — which is every render, since the tree
    // is rebuilt each time — must not undo that.
    rerender(panel(site(4)));
    expect(screen.queryByText("/page-0")).toBeNull();
  });

  // The sitemap arrives after mount, so the first render of every project is a
  // project with no pages at all.
  test("opens a site map that arrives late", () => {
    const { rerender } = render(panel([]));
    rerender(panel(site(3)));
    expect(screen.queryByText("/page-0")).not.toBeNull();
  });

  /**
   * And once it has arrived, how it is expanded belongs to the reader.
   *
   * This was keyed on the page COUNT, which is not a tree shape: adding a page
   * after collapsing a folder changed the count, and the folder was reopened
   * underneath whoever had just closed it.
   */
  test("adding a page does not reopen a folder that was closed", () => {
    const { rerender } = render(panel(site(4)));
    fireEvent.click(screen.getByText("Home"));
    expect(screen.queryByText("/page-0")).toBeNull();
    rerender(panel(site(5)));
    expect(screen.queryByText("/page-0")).toBeNull();
  });

  // The mirror of it: a big site edited down past the threshold must not
  // suddenly open itself either.
  test("a site that shrinks past the threshold stays as it was", () => {
    const { rerender } = render(panel(site(40)));
    expect(screen.queryByText("/page-0")).toBeNull();
    rerender(panel(site(5)));
    expect(screen.queryByText("/page-0")).toBeNull();
  });
});
