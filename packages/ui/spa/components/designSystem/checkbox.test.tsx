/** @jest-environment jsdom */
import fs from "fs";
import path from "path";
import { fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "./checkbox";

/**
 * What a checkbox looks like, and whether it looks like anything at all.
 *
 * The border used to name `--primary-foreground`, a token from the shadcn
 * compatibility block that is declared under `:root` and `.dark` — selectors
 * the Studio's shadow root never matches, and `.dark` matches nowhere at all
 * because `darkMode` is `[data-mode="dark"]`. Measured in Chromium: inside a
 * shadow root with no declaration above it the `border-color` declaration is
 * invalid at computed-value time and falls back to `currentColor`; in a
 * document where `:root` does match — Storybook — it computes to #fcfcfc,
 * which on a pale panel is a checkbox you cannot see.
 *
 * `focusRingTokens.test.ts` holds the same line for focus rings, and its
 * reasoning is the longer version of this one.
 */
const CSS = fs.readFileSync(
  path.join(__dirname, "..", "..", "index.css"),
  "utf8",
);

/** The custom properties declared in a block whose selector a shadow root matches. */
function shadowVisibleTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const selector of ['*[data-mode="light"]', '*[data-mode="dark"]']) {
    const start = CSS.indexOf(selector);
    if (start === -1) throw new Error(`No block for selector ${selector}`);
    const open = CSS.indexOf("{", start);
    const body = CSS.slice(open + 1, CSS.indexOf("\n  }", open));
    for (const line of body.split("\n")) {
      const match = line.match(/^\s*(--[\w-]+)\s*:/);
      if (match) tokens.add(match[1]);
    }
  }
  return tokens;
}

/** Every `bg-`/`border-`/`text-` token class the component names. */
function tokenClassesOf(source: string): string[] {
  return [
    ...source.matchAll(/\b(?:bg|border|text|ring)-((?:bg|fg|border)-[\w-]+)/g),
  ].map((match) => match[1]);
}

/**
 * The component's code without its prose.
 *
 * The comment in `checkbox.tsx` names both of the classes that were wrong, in
 * order to explain them - so a scan that reads the whole file finds them and
 * fails on the explanation.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("checkbox colours", () => {
  const source = code(
    fs.readFileSync(path.join(__dirname, "checkbox.tsx"), "utf8"),
  );

  test("the test is actually reading the component", () => {
    expect(tokenClassesOf(source).length).toBeGreaterThan(4);
  });

  test("every colour it names is a token a shadow root can see", () => {
    const declared = shadowVisibleTokens();
    const offenders = tokenClassesOf(source).filter(
      (token) => !declared.has(`--${token}`),
    );
    expect(offenders).toEqual([]);
  });

  test("it does not reach for the dead shadcn block", () => {
    // The specific class that was wrong, named so a revert is loud.
    expect(source).not.toContain("border-primary-foreground");
  });

  test("checked does not paint the same background as unchecked", () => {
    // `data-[state=checked]:bg-bg-primary` was the original, and it set the
    // background the box already had.
    const base = source.match(/\bbg-(bg-[\w-]+)/)?.[1];
    const checked = source.match(/data-\[state=checked\]:bg-(bg-[\w-]+)/)?.[1];
    expect(base).toBeDefined();
    expect(checked).toBeDefined();
    expect(checked).not.toBe(base);
  });
});

describe("a checkbox", () => {
  test("shows nothing when it is unchecked", () => {
    render(<Checkbox aria-label="Pick" checked={false} />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("data-state")).toBe("unchecked");
    expect(box.querySelector("svg")).toBeNull();
  });

  test("shows a tick when it is checked", () => {
    render(<Checkbox aria-label="Pick" checked />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("data-state")).toBe("checked");
    expect(box.querySelector("svg.lucide-check")).not.toBeNull();
  });

  test("shows a tick when it merely STARTS checked", () => {
    // The mirrored state this component used to carry had nothing to mirror
    // here, so an uncontrolled checkbox that starts checked rendered empty.
    render(<Checkbox aria-label="Pick" defaultChecked />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("data-state")).toBe("checked");
    expect(box.querySelector("svg.lucide-check")).not.toBeNull();
  });

  test("marks itself indeterminate rather than checked", () => {
    render(<Checkbox aria-label="Pick" checked="indeterminate" />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("data-state")).toBe("indeterminate");
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    // Both icons are in the DOM; the state picks one in CSS, which jsdom does
    // not apply - so what is asserted is that the class carries the state.
    expect(
      box.querySelector("svg.lucide-minus")?.getAttribute("class"),
    ).toContain("group-data-[state=indeterminate]/checkbox:block");
  });

  test("ticks when clicked, once", () => {
    const changes: unknown[] = [];
    render(
      <Checkbox
        aria-label="Pick"
        checked={false}
        onCheckedChange={(next) => changes.push(next)}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(changes).toEqual([true]);
  });

  test("takes a className without losing its own", () => {
    render(<Checkbox aria-label="Pick" checked={false} className="w-3.5" />);
    const className = screen.getByRole("checkbox").getAttribute("class") ?? "";
    expect(className).toContain("w-3.5");
    expect(className).toContain("border-border-primary");
  });
});
