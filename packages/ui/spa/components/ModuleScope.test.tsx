/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import {
  ScopePart,
  ScopeTrail,
  scopePartsBelowPageRouter,
} from "./ModuleScope";

/**
 * The scope line is made of links.
 *
 * It used to be plain text with a `disabled` overflow menu — you could read
 * where you were and not go there. What is pinned here is the three rules the
 * header's doc comment states, because each of them is a thing that was wrong
 * and would be easy to make wrong again: real anchors carrying the URL the
 * navigation goes to, modified clicks left to the browser, and path segments
 * rather than preview titles.
 */
const mockNavigate = jest.fn();
const mockHrefOf = jest.fn(
  (path: string) => `/val/~${path.split("?")[0]}?p=${encodeURIComponent(path)}`,
);

jest.mock("./ValRouter", () => ({
  __esModule: true,
  VAL_COMPARE_ROUTE: "/val/compare",
  VAL_ERRORS_ROUTE: "/val/errors",
  useNavigation: () => ({ navigate: mockNavigate, hrefOf: mockHrefOf }),
}));

function part(text: string, sourcePath: string): ScopePart {
  return { text, sourcePath: sourcePath as SourcePath };
}

const AUTHORS = "/content/authors.val.ts";
const ONE = '/content/authors.val.ts?p="one"';
const TWO = '/content/authors.val.ts?p="one"."bio"';

function trail(parts: ScopePart[]) {
  return <ScopeTrail parts={parts} portalContainer={null} />;
}

describe("the scope trail", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockHrefOf.mockClear();
  });

  test("renders every segment as a link to where it goes", () => {
    render(trail([part("Authors", AUTHORS), part("one", ONE)]));
    const one = screen.getByText("one").closest("a");
    expect(one).not.toBeNull();
    expect(one!.getAttribute("href")).toBe(mockHrefOf(ONE));
  });

  test("a plain click navigates in-app instead of following the href", () => {
    render(trail([part("Authors", AUTHORS), part("one", ONE)]));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(screen.getByText("one"), event);
    expect(mockNavigate).toHaveBeenCalledWith(ONE, {
      scrollToPath: undefined,
      errorFields: undefined,
    });
    expect(event.defaultPrevented).toBe(true);
  });

  test("a cmd-click is the browser's, so it opens a tab and does not navigate", () => {
    render(trail([part("Authors", AUTHORS), part("one", ONE)]));
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    fireEvent(screen.getByText("one"), event);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test("the arrow is on the last segment, which is the level above", () => {
    render(
      trail([part("Authors", AUTHORS), part("one", ONE), part("Bio", TWO)]),
    );
    const up = screen.getByLabelText("Up one level, to Bio");
    expect(up.getAttribute("href")).toBe(mockHrefOf(TWO));
    // And it is the only arrow: the segments above it are plain links.
    expect(
      screen.getByText("one").closest("a")!.getAttribute("aria-label"),
    ).toBeNull();
  });

  /**
   * A trail segment is a PATH segment, whatever a `.preview(...)` calls the
   * value there.
   *
   * A preview is a title — what a thing is called where it is shown as a thing.
   * This line is where you ARE, and where you are is a path. It also must not
   * move under an editor as they type, which a title computed from source does.
   */
  test("a segment keeps its path name, never a preview title", () => {
    render(trail([part("Authors", AUTHORS), part("teddy", ONE)]));
    expect(screen.getByText("Authors")).not.toBeNull();
    expect(screen.getByText("teddy")).not.toBeNull();
  });

  test("a long path collapses its middle, and says how much is hidden", () => {
    render(
      trail([
        part("Authors", AUTHORS),
        part("a", '/content/authors.val.ts?p="a"' as SourcePath),
        part("b", '/content/authors.val.ts?p="a"."b"' as SourcePath),
        part("c", '/content/authors.val.ts?p="a"."b"."c"' as SourcePath),
        part("d", '/content/authors.val.ts?p="a"."b"."c"."d"' as SourcePath),
      ]),
    );
    // First, then the overflow, then the last two.
    expect(screen.getByLabelText("2 more levels")).not.toBeNull();
    expect(screen.queryByText("b")).toBeNull();
    expect(screen.getByText("c")).not.toBeNull();
    expect(screen.getByText("d")).not.toBeNull();
  });

  test("a directory is text, not a link", () => {
    render(
      trail([
        {
          text: "Content",
          sourcePath: AUTHORS as SourcePath,
          isDirectory: true,
        },
        part("Authors", AUTHORS),
      ]),
    );
    // Both segments carry the module's own path, so linking the folder offered a
    // second route to the same place under a name that is not a place.
    expect(screen.getByText("Content").closest("a")).toBeNull();
    expect(screen.getByText("Authors").closest("a")).not.toBeNull();
  });

  test("no arrow when the level above is only a directory", () => {
    // On a module's own page the segment above it is its folder. "Up" there went
    // to the module you were already looking at.
    render(
      trail([
        {
          text: "Content",
          sourcePath: AUTHORS as SourcePath,
          isDirectory: true,
        },
      ]),
    );
    expect(screen.queryByLabelText(/^Up one level/)).toBeNull();
    expect(screen.getByText("Content")).not.toBeNull();
  });

  test("nothing to show above the module means no trail at all", () => {
    const { container } = render(trail([]));
    expect(container.querySelector("nav")).toBeNull();
  });
});

/**
 * A page's location is its ROUTE — not the file the route happens to live in.
 */
describe("scopePartsBelowPageRouter", () => {
  const PAGES = "/app/blogs/[blog]/page.val.ts";
  const ROUTE = `${PAGES}?p="/blogs/blog2"` as SourcePath;
  /** What `splitIntoInitAndLastParts` produces: every file segment shares the
   *  module's own path as its `sourcePath`. */
  const fileParts: ScopePart[] = [
    { text: "App", sourcePath: PAGES as SourcePath, isDirectory: true },
    { text: "Blogs", sourcePath: PAGES as SourcePath, isDirectory: true },
    { text: "Blog", sourcePath: PAGES as SourcePath, isDirectory: true },
    { text: "Pages", sourcePath: PAGES as SourcePath },
  ];

  test("a page's trail drops the file it lives in", () => {
    expect(scopePartsBelowPageRouter(fileParts, PAGES, true)).toEqual([]);
  });

  test("a field inside a page keeps the route above it", () => {
    const route: ScopePart = { text: "/blogs/blog2", sourcePath: ROUTE };
    expect(
      scopePartsBelowPageRouter([...fileParts, route], PAGES, true),
    ).toEqual([route]);
  });

  test("anything not inside a page router keeps its whole trail", () => {
    expect(scopePartsBelowPageRouter(fileParts, PAGES, false)).toEqual(
      fileParts,
    );
  });
});
