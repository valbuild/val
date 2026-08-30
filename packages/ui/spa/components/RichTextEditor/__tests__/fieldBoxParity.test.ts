import fs from "fs";
import path from "path";

/**
 * A rich text field is a text field, and is sized like one.
 *
 * The two sit in the same column of the same form, so a rich text box that is
 * taller and more inset than the string box above it reads as a different KIND
 * of control. It was: `min-h-12` and `p-4` against `h-10` and `px-3 py-2`, so a
 * one-line rich text field stood 68px tall next to a 40px string field, with
 * its text starting 4px further in.
 *
 * Measured in Chromium against the compiled stylesheet, the two now agree on
 * padding (8px/12px), width and left edge exactly. The heights are 42px and
 * 40px: `Input` has a FIXED `h-10` whose 40px includes its border and crops its
 * own line box, while this one has to grow with its content, so one 24px line
 * plus 16px padding plus 2px border is 42. Closing that last 2px would mean
 * either unequal padding or a tighter line-height than the rest of the prose —
 * both worse than the 2px.
 *
 * Classes rather than layout because jsdom computes none; the numbers above are
 * what the browser check is for. What this pins is that the two declarations do
 * not drift apart again.
 */

const SPA = path.resolve(__dirname, "../../..");

function classesOf(file: string, marker: string): string[] {
  const src = fs.readFileSync(path.join(SPA, file), "utf8");
  const line = src.split("\n").find((l) => l.includes(marker));
  if (line === undefined)
    throw new Error(`No line matching ${marker} in ${file}`);
  return line.split(/[\s"'`]+/).filter(Boolean);
}

/**
 * The editor's classes come from a multi-line array, so one line is not the
 * whole declaration — `rounded-md` lives on the focus-ring line and the padding
 * on its own.
 */
function editorContainerClasses(): string[] {
  const src = fs.readFileSync(
    path.join(SPA, "components/RichTextEditor/RichTextEditor.tsx"),
    "utf8",
  );
  const start = src.indexOf("ref={containerRef}");
  if (start === -1) throw new Error("no editor container");
  const block = src
    .slice(start, src.indexOf('].join(" ")}', start))
    // The comment above these classes talks ABOUT them, naming `px-3 py-2` and
    // `pt-14` in prose. Tokenising that would assert against the explanation.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return block.split(/[\s"'`,[\]]+/).filter(Boolean);
}

/** The utilities that decide a field's box. Everything else is free to differ. */
function boxUtilities(classes: string[]): string[] {
  return classes
    .filter((c) => /^(p[xytblr]?-|text-(base|sm|xs)$|rounded-|border$)/.test(c))
    .sort();
}

describe("the rich text box matches the string box", () => {
  const input = classesOf("components/designSystem/input.tsx", "flex h-10 m-1");
  const editorBox = editorContainerClasses();
  const editorPadding = editorBox;

  test("same horizontal and vertical padding", () => {
    const padding = (cs: string[]) =>
      cs.filter((c) => /^p[xy]-/.test(c)).sort();
    expect(padding(editorPadding)).toEqual(padding(input));
    expect(padding(input)).toEqual(["px-3", "py-2"]);
  });

  test("same corner radius and border", () => {
    expect(boxUtilities(editorBox)).toContain("rounded-md");
    expect(boxUtilities(editorBox)).toContain("border");
    expect(boxUtilities(input)).toContain("rounded-md");
    expect(boxUtilities(input)).toContain("border");
  });

  test("the editor's minimum height is the string field's height", () => {
    // `min-h-10`, not `h-10`: it is the same 2.5rem, but this one grows.
    expect(editorBox).toContain("min-h-10");
    expect(input).toContain("h-10");
  });

  test("a toolbar still overrides the top padding", () => {
    // `pt-14` reserves room for the bar. Tailwind emits `pt-*` after `py-*`, so
    // the single-side utility wins — which is the only reason `px-3 py-2` can
    // replace `p-4` here without breaking the toolbar case.
    const src = fs.readFileSync(
      path.join(SPA, "components/RichTextEditor/RichTextEditor.tsx"),
      "utf8",
    );
    expect(src).toContain('showFixedToolbar ? "pt-14" : ""');
  });
});
