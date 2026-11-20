/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import {
  BackLink,
  parentDestination,
  ScopePart,
  scopePartsBelowPageRouter,
} from "./ModuleScope";

/**
 * The line under the heading is the way back: one link, to where the level
 * above is shown, named by its title.
 *
 * It used to be a breadcrumb of path segments, and every segment between a page
 * and a section of it opened the same page — so it offered several labels for
 * one destination, and gave the one that mattered a field name.
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

const PRODUCTS = "/src/routes/_site.products.$sku.val.ts";
const PRODUCT = `${PRODUCTS}?p="/products/product-1"` as SourcePath;
const SECTIONS = `${PRODUCT}."sections"` as SourcePath;
const SECTION = `${SECTIONS}.0` as SourcePath;
const AUTHORS = "/content/authors.val.ts";
const AUTHORS_MODULE = AUTHORS as SourcePath;
const TEDDY = '/content/authors.val.ts?p="teddy"' as SourcePath;

/**
 * Where each path is shown, as `getNavPath` answers it for that module: an item
 * of `sections` is its own stop, and everything else on the page is the page.
 */
const STOPS: SourcePath[] = [SECTION, PRODUCT, TEDDY, AUTHORS_MODULE];
function navPathOf(path: string): SourcePath | null {
  const stop = STOPS.find((stop) => stop === path);
  if (stop !== undefined) {
    return stop;
  }
  return path.startsWith(PRODUCT) ? PRODUCT : null;
}

describe("parentDestination", () => {
  test("a section's parent is the page it is edited on, not its list", () => {
    // What `Module` hands over for a section: the route and the field, the file
    // having been dropped by `scopePartsBelowPageRouter`.
    const parts = [
      part("/products/product-1", PRODUCT),
      part("sections", SECTIONS),
    ];
    expect(parentDestination(parts, SECTION, navPathOf)).toBe(PRODUCT);
  });

  test("a record entry's parent is its module", () => {
    const parts: ScopePart[] = [
      { text: "Content", sourcePath: AUTHORS as SourcePath, isDirectory: true },
      part("Authors", AUTHORS),
    ];
    expect(parentDestination(parts, TEDDY, navPathOf)).toBe(AUTHORS);
  });

  test("a folder is not a parent", () => {
    // On a module's own page the only thing above it is its folder.
    const parts: ScopePart[] = [
      { text: "Content", sourcePath: AUTHORS as SourcePath, isDirectory: true },
    ];
    expect(
      parentDestination(parts, AUTHORS as SourcePath, navPathOf),
    ).toBeNull();
  });

  test("nothing above means no way back", () => {
    expect(parentDestination([], PRODUCT, navPathOf)).toBeNull();
  });

  test("a level that resolves to here is skipped", () => {
    const parts = [part("Authors", AUTHORS), part("teddy", TEDDY)];
    const here = `${TEDDY}."bio"` as SourcePath;
    expect(
      parentDestination(parts, here, (p) =>
        p === TEDDY ? here : navPathOf(p),
      ),
    ).toBe(AUTHORS);
  });
});

describe("the back link", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockHrefOf.mockClear();
  });

  test("names the parent and links to it", () => {
    render(<BackLink to={PRODUCT} name="Product 1" />);
    const link = screen.getByRole("link", { name: "Back to Product 1" });
    expect(link.getAttribute("href")).toBe(mockHrefOf(PRODUCT));
  });

  test("shows the name and a chevron, not the words", () => {
    const { container } = render(<BackLink to={PRODUCT} name="Product 1" />);
    expect(container.textContent).toBe("Product 1");
    expect(container.querySelector("a svg")).not.toBeNull();
  });

  test("a plain click navigates in-app instead of following the href", () => {
    render(<BackLink to={PRODUCT} name="Product 1" />);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(screen.getByText("Product 1"), event);
    expect(mockNavigate).toHaveBeenCalledWith(PRODUCT, {
      scrollToPath: undefined,
      errorFields: undefined,
    });
    expect(event.defaultPrevented).toBe(true);
  });

  test("a cmd-click is the browser's, so it opens a tab and does not navigate", () => {
    render(<BackLink to={PRODUCT} name="Product 1" />);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    fireEvent(screen.getByText("Product 1"), event);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
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
