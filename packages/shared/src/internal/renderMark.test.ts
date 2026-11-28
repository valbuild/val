/**
 * @jest-environment jsdom
 */
import {
  isLaterRender,
  markRendered,
  readRendered,
  renderIdOf,
} from "./renderMark";

/**
 * Render ids: what a Studio tool that changes the page (an edit, a quick
 * preview, a Build) answers with, and what the page writes on itself once it
 * shows that change, for `read_page` to wait for. See `renderMark.ts`.
 */
describe("render ids", () => {
  test("a Studio's ids are in the order it made them", () => {
    const first = renderIdOf(1700000000000, 1);
    const second = renderIdOf(1700000000000, 2);
    const tenth = renderIdOf(1700000000000, 10);
    expect(isLaterRender(second, first)).toBe(true);
    expect(isLaterRender(tenth, second)).toBe(true);
    expect(isLaterRender(first, second)).toBe(false);
    expect(isLaterRender(first, first)).toBe(false);
  });

  test("a Studio opened later makes later ids, whatever it counted to", () => {
    const old = renderIdOf(1700000000000, 99);
    const fresh = renderIdOf(1700000005000, 1);
    expect(isLaterRender(fresh, old)).toBe(true);
  });

  test("an id that is not one is never later, and anything is later than none", () => {
    const id = renderIdOf(1700000000000, 1);
    expect(isLaterRender("not-an-id", id)).toBe(false);
    expect(isLaterRender(id, null)).toBe(true);
    expect(isLaterRender(id, "not-an-id")).toBe(true);
  });

  test("the page keeps the latest it was told, on its root, as no text", () => {
    document.documentElement.removeAttribute("data-val-render");
    const first = renderIdOf(1700000000000, 1);
    const second = renderIdOf(1700000000000, 2);
    expect(readRendered(document)).toBeNull();
    markRendered(document, second);
    markRendered(document, first);
    expect(readRendered(document)).toBe(second);
    expect(document.body.textContent ?? "").not.toContain(second);
  });
});
