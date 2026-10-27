import jsxRuntime from "react/jsx-runtime";
import { initVal } from "@valbuild/core";
import { VERCEL_STEGA_REGEX } from "@vercel/stega";
import { autoTagJSX } from "./autoTagJSX";
import { stegaEncode, type ResolvedVal } from "./stegaEncode";
import { SET_AUTO_TAG_JSX_ENABLED } from ".";

const { s, c } = initVal();

const linkVal = c.define(
  "/content/link.val.ts",
  s.object({ title: s.string(), blurb: s.string() }),
  { title: "Val", blurb: "Content as code" },
);
const TITLE = '/content/link.val.ts?p="title"';
const BLURB = '/content/link.val.ts?p="blurb"';

beforeAll(() => {
  autoTagJSX();
  SET_AUTO_TAG_JSX_ENABLED(true);
});
afterAll(() => SET_AUTO_TAG_JSX_ENABLED(false));

/** The props of a React element, read the way React does. */
function propsOf(element: unknown): Record<string, unknown> {
  if (
    typeof element === "object" &&
    element !== null &&
    "props" in element &&
    typeof element.props === "object" &&
    element.props !== null
  ) {
    return { ...element.props };
  }
  throw new Error("not a React element");
}

const hasTag = (value: unknown) =>
  JSON.stringify(value).match(VERCEL_STEGA_REGEX) !== null;

describe("autoTagJSX", () => {
  test("a fragment's text is cleaned, and the element it is in carries its path", () => {
    const link: ResolvedVal<typeof linkVal> = stegaEncode(linkVal, {});
    const { jsx, jsxs, Fragment } = jsxRuntime;
    // <li><a>{link.title}</a><> — {link.blurb}</></li>
    const fragment = jsxs(Fragment, { children: [" — ", link.blurb] });
    const anchor = jsx("a", { children: link.title });
    const li = jsxs("li", { children: [anchor, fragment] });

    expect(propsOf(fragment).children).toEqual([" — ", "Content as code"]);
    expect(propsOf(anchor)).toEqual({
      children: "Val",
      "data-val-path": TITLE,
    });
    expect(propsOf(li)["data-val-path"]).toBe(BLURB);
    expect(hasTag(propsOf(li).children)).toBe(false);
  });

  test("a fragment in a fragment hands its path up to the element", () => {
    const link: ResolvedVal<typeof linkVal> = stegaEncode(linkVal, {});
    const { jsx, Fragment } = jsxRuntime;
    const inner = jsx(Fragment, { children: link.blurb });
    const outer = jsx(Fragment, { children: inner });
    const p = jsx("p", { children: outer });

    expect(propsOf(inner).children).toBe("Content as code");
    expect(propsOf(p)["data-val-path"]).toBe(BLURB);
  });

  test("keyed fragments from a map hand their paths to the element", () => {
    const link: ResolvedVal<typeof linkVal> = stegaEncode(linkVal, {});
    const { jsx, jsxs, Fragment } = jsxRuntime;
    // <dl><dt>Links</dt>{[link].map((l) => <Fragment key="val">{l.blurb}</Fragment>)}</dl>
    const fragments = [link].map((l) =>
      jsx(Fragment, { children: l.blurb }, "val"),
    );
    const dl = jsxs("dl", {
      children: [jsx("dt", { children: "Links" }), fragments],
    });

    expect(propsOf(fragments[0]).children).toBe("Content as code");
    expect(propsOf(dl)["data-val-path"]).toBe(BLURB);
  });
});
