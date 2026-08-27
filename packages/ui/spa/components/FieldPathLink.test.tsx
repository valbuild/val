/** @jest-environment jsdom */
// FIRST, and it must stay first: `urlOf` comes from the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import { FieldPathLink } from "./FieldPathLink";

/**
 * The paths listed by the errors view and the compare view.
 *
 * Both used to render them as `<button onClick={navigate}>`, with the same
 * class string and the same navigation body copied into each — so neither could
 * be middle-clicked into a new tab while fixing errors one at a time, which is
 * exactly how that view is used.
 */
const mockNavigate = jest.fn();
jest.mock("./ValRouter", () => ({
  __esModule: true,
  VAL_COMPARE_ROUTE: "/val/compare",
  VAL_ERRORS_ROUTE: "/val/errors",
  useNavigation: () => ({
    navigate: mockNavigate,
    hrefOf: (path: string, params?: { scrollToPath?: string }) =>
      `/val/~${path}${params?.scrollToPath ? "#" + params.scrollToPath : ""}`,
  }),
}));

jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useSchemas: () => ({ status: "success", data: {} }),
  useAllSources: () => ({}),
}));

/** The leaf is opened at its nearest sensible ancestor — see `getNavPath`. */
const mockNavPath = { current: undefined as string | undefined };
jest.mock("./getNavPath", () => ({
  __esModule: true,
  getNavPathFromAll: () => mockNavPath.current,
}));

const LEAF = '/content/page.val.ts?p="/"."title"' as SourcePath;
const ANCESTOR = '/content/page.val.ts?p="/"';

describe("a field path in a list", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockNavPath.current = undefined;
  });

  test("is a link, carrying the URL its click goes to", () => {
    render(<FieldPathLink sourcePath={LEAF}>title</FieldPathLink>);
    const link = screen.getByText("title");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`/val/~${LEAF}`);
  });

  test("points at the ancestor it opens, scrolled to the field asked for", () => {
    mockNavPath.current = ANCESTOR;
    render(<FieldPathLink sourcePath={LEAF}>title</FieldPathLink>);
    expect(screen.getByText("title").getAttribute("href")).toBe(
      `/val/~${ANCESTOR}#${LEAF}`,
    );
  });

  test("a page of a router also offers the page itself", () => {
    render(
      <FieldPathLink sourcePath={LEAF} previewSegment="/blog">
        /blog
      </FieldPathLink>,
    );
    const preview = screen.getByTitle("Preview /blog");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("href")).toContain("/api/val/enable");
  });

  test("and a plain field does not", () => {
    render(<FieldPathLink sourcePath={LEAF}>title</FieldPathLink>);
    expect(screen.queryByTitle(/^Preview /)).toBeNull();
  });
});
