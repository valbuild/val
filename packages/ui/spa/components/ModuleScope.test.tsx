/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import { ScopePart, ScopeTrail, StickyScopeBar } from "./ModuleScope";

/**
 * The scope line is made of links.
 *
 * It used to be plain text with a `disabled` overflow menu — you could read
 * where you were and not go there. What is pinned here is the three rules the
 * header's doc comment states, because each of them is a thing that was wrong
 * and would be easy to make wrong again: real anchors carrying the URL the
 * navigation goes to, modified clicks left to the browser, and the parent named
 * by its own title rather than its raw key.
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

const mockPreviews: Record<string, string> = {};
jest.mock("./useRefPreview", () => ({
  __esModule: true,
  useRefPreview: (path: string) =>
    mockPreviews[path] ? { title: mockPreviews[path] } : undefined,
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
    for (const key of Object.keys(mockPreviews)) {
      delete mockPreviews[key];
    }
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

  test("the arrow is named by the parent's title, not its key", () => {
    mockPreviews[TWO] = "Biography";
    render(
      trail([part("Authors", AUTHORS), part("one", ONE), part("bio", TWO)]),
    );
    expect(
      screen.getByLabelText("Up one level, to Biography").getAttribute("href"),
    ).toBe(mockHrefOf(TWO));
  });

  test("a segment is named by its title, not its key", () => {
    mockPreviews[ONE] = "Ada Lovelace";
    render(trail([part("Authors", AUTHORS), part("one", ONE)]));
    expect(screen.queryByText("one")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
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

  test("nothing to show above the module means no trail at all", () => {
    const { container } = render(trail([]));
    expect(container.querySelector("nav")).toBeNull();
  });
});

describe("the sticky scope bar", () => {
  test("is out of reach until the header has been scrolled past", () => {
    const { container, rerender } = render(
      <StickyScopeBar
        parent={part("Authors", AUTHORS)}
        title="one"
        visible={false}
      />,
    );
    const bar = container.querySelector("[aria-hidden]");
    expect(bar?.className).toContain("invisible");
    rerender(
      <StickyScopeBar
        parent={part("Authors", AUTHORS)}
        title="one"
        visible={true}
      />,
    );
    expect(
      container.querySelector("[aria-hidden='false']")?.className,
    ).toContain("visible");
  });

  test("sticks below whatever is covering the column", () => {
    const { container } = render(
      <div data-scroll-clearance={96}>
        <StickyScopeBar parent={null} title="one" visible={true} />
      </div>,
    );
    const flow = container.querySelector(".sticky");
    expect(flow).not.toBeNull();
    // Flush to the scroller's top edge would put it behind the floating top bar.
    expect((flow as HTMLElement).style.top).toBe("96px");
  });

  test("takes up no room, so revealing it moves nothing", () => {
    const { container } = render(
      <StickyScopeBar parent={null} title="one" visible={true} />,
    );
    // The flow box is zero-height and sticky; the bar floats out of it.
    expect(container.firstElementChild?.className).toContain("h-0");
    expect(container.firstElementChild?.className).toContain("sticky");
  });
});
