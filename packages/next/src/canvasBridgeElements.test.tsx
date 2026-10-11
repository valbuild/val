/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * Which tagged elements the page reports to the studio.
 *
 * The report is what the studio's "On this page" column is built from, so an
 * element missing from it is a field missing from the column. The rule pinned
 * here: an element with no BOX is not on the page, and an element with an EMPTY
 * box is.
 *
 * The second half is the one that was got wrong. An inline element whose only
 * text is the invisible edit tag measures 0×0 — which is exactly what a field
 * looks like the moment an editor clears it — and dropping it took the field
 * out of the column mid-edit, along with every other path on the same element.
 */
describe("the canvas bridge reporting what is on the page", () => {
  const SHOWN = '/content/page.val.ts?p="title"';
  const EMPTIED = '/content/page.val.ts?p="link"."label"';
  const SHARED = '/content/page.val.ts?p="link"."href"';
  const HIDDEN = '/content/page.val.ts?p="mobileOnly"';

  /** See `canvasBridgeScroll.test.tsx` for why these are not spies. */
  const originals: { owner: object; key: string; value: unknown }[] = [];
  const replace = (owner: object, key: string, value: unknown) => {
    originals.push({
      owner,
      key,
      value: key in owner ? Reflect.get(owner, key) : undefined,
    });
    Reflect.set(owner, key, value);
  };
  let posted: unknown[];

  beforeEach(() => {
    posted = [];
    replace(
      globalThis,
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // The scan is coalesced into an animation frame; run it at once.
    replace(
      window,
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    );
    /*
     * jsdom has no layout, so every element has no box and a zero rect. Give
     * each one the layout it would have in a browser: a hidden one has no
     * client rects at all, an emptied one has a single 0×0 rect, and the rest
     * have a real one.
     */
    const zero = { top: 0, left: 0, width: 0, height: 0 };
    const real = { top: 10, left: 10, width: 100, height: 20 };
    replace(Element.prototype, "getClientRects", function (this: Element) {
      const paths = this.getAttribute("data-val-path") ?? "";
      if (paths === HIDDEN) return [];
      return [paths.includes(EMPTIED) ? zero : real];
    });
    replace(
      Element.prototype,
      "getBoundingClientRect",
      function (this: Element) {
        const paths = this.getAttribute("data-val-path") ?? "";
        return paths === SHOWN ? real : zero;
      },
    );
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation((message: unknown) => {
        posted.push(message);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const { owner, key, value } of originals.reverse()) {
      if (value === undefined) Reflect.deleteProperty(owner, key);
      else Reflect.set(owner, key, value);
    }
    originals.length = 0;
  });

  function reportedPaths(): string[] {
    const reports = posted.filter(
      (
        message,
      ): message is Extract<ValCanvasPageMessage, { type: "elements" }> =>
        typeof message === "object" &&
        message !== null &&
        "val" in message &&
        message.val === VAL_CANVAS_MESSAGE &&
        "type" in message &&
        message.type === "elements",
    );
    const last = reports[reports.length - 1];
    return last ? last.elements.flatMap((element) => element.paths) : [];
  }

  it("reports an emptied element, and every path on it", () => {
    render(
      <>
        <h1 data-val-path={SHOWN}>Title</h1>
        <a data-val-path={`${SHARED},${EMPTIED}`} href="/somewhere" />
        <nav data-val-path={HIDDEN}>Only on a phone</nav>
        <ValCanvasBridge draftMode />
      </>,
    );

    expect(reportedPaths()).toEqual([SHOWN, SHARED, EMPTIED]);
  });
});
