/** @jest-environment jsdom */
// FIRST, and it must stay first: the editor pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../../stores/react/testPolyfills";
import { render } from "@testing-library/react";
import { RichTextEditor } from "../RichTextEditor";
import { Input } from "../../designSystem/input";

/**
 * A rich text field is a text field, and is sized like one.
 *
 * The two sit in the same column of the same form, so a rich text box that is
 * taller and more inset than the string box above it reads as a different KIND
 * of control. It was: `min-h-12` and `p-4` against `h-10` and `px-3 py-2`, so a
 * one-line rich text field stood 68px tall beside a 40px string field, with its
 * text starting 4px further in.
 *
 * Measured in Chromium against the compiled stylesheet, the two now agree on
 * padding (8px/12px), width and left edge exactly. The heights are 42px and
 * 40px: `Input` has a FIXED `h-10` whose 40px includes its border and crops its
 * own line box, while this one grows with its content, so one 24px line plus
 * 16px padding plus 2px border is 42. Closing that last 2px would mean either
 * unequal padding or a tighter line-height than the rest of the prose.
 *
 * Asserted on the RENDERED class list rather than on the source text. jsdom
 * computes no layout, so the pixels above are the browser's job — but which
 * utilities each control ends up carrying is a real output, and reading it off
 * the DOM survives the class string being reassembled, moved into `cn()`, or
 * split across lines. An earlier version of this file regexed the source and
 * twice asserted against its own explanatory comment.
 */

/**
 * The toolbars and the gutter measure the document, and jsdom has no layout.
 * Off here for the same reason `viewRebuild.test.tsx` turns them off: they are
 * not what this is about, and the padding under test is the same either way.
 */
const NO_MEASURING = {
  fixedToolbar: false,
  floatingToolbar: false,
  gutter: false,
};

function classesOf(el: Element | null): Set<string> {
  if (el === null) throw new Error("expected an element");
  return new Set(el.className.split(/\s+/).filter(Boolean));
}

function editorBox(): Set<string> {
  const { container } = render(
    <RichTextEditor features={NO_MEASURING} defaultValue={[]} />,
  );
  return classesOf(container.querySelector(".prose-editor"));
}

function inputBox(): Set<string> {
  const { container } = render(<Input />);
  return classesOf(container.querySelector("input"));
}

/** The utilities that decide a field's box. Everything else may differ. */
function padding(classes: Set<string>): string[] {
  return [...classes].filter((c) => /^p[xy]-/.test(c)).sort();
}

describe("the rich text box matches the string box", () => {
  test("same horizontal and vertical padding", () => {
    expect(padding(editorBox())).toEqual(["px-3", "py-2"]);
    expect(padding(inputBox())).toEqual(["px-3", "py-2"]);
  });

  test("same corner radius and border", () => {
    for (const box of [editorBox(), inputBox()]) {
      expect(box.has("rounded-md")).toBe(true);
      expect(box.has("border")).toBe(true);
      expect(box.has("border-border-primary")).toBe(true);
    }
  });

  test("the editor's minimum height is the string field's height", () => {
    // The same 2.5rem, but `min-h-10` because this one grows with its content.
    expect(editorBox().has("min-h-10")).toBe(true);
    expect(inputBox().has("h-10")).toBe(true);
  });

  test("both render text at 16px, which is also what iOS needs", () => {
    // `text-base` on the input; the editor sets it on the paragraphs in
    // `index.css`, so what matters here is that neither shrinks the box's own
    // text below it.
    expect(inputBox().has("text-base")).toBe(true);
    expect([...editorBox()].some((c) => /^text-(xs|sm)$/.test(c))).toBe(false);
  });
});
