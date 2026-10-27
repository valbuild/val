import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * The layering scale, enforced where it matters.
 *
 * `tailwind.config.js` defines four named layers — `hover`, `window`, `full`,
 * `overlay` — and a raw number beats all of them. That has now cost the same bug
 * twice: the rich text selection toolbar at `z-50` rendered over the shell's
 * Pages panel, and a node view at `z-[60]` rendered over that. Neither is
 * visible in a screenshot of the thing you were working on, because the two
 * surfaces only meet when a panel happens to be open over an editor.
 *
 * A source test rather than an e2e one on purpose: what goes wrong is a class
 * name, the failure is a specific pair of components overlapping, and driving a
 * selection toolbar and a floating panel into overlap is fiddly enough to be
 * flaky — which would make the guard worth less than the thing it guards.
 *
 * Scoped to the shell and the editors that live inside it. The classic UI and
 * `ValOverlay` predate this scale and have their own layering; sweeping them in
 * is a separate job, not a thing to smuggle into a test.
 */
const GUARDED = ["shell", "RichTextEditor", "AIChatEditor"].map((dir) =>
  join(__dirname, dir),
);

/** `z-50`, `z-5`, `z-[60]`, `z-[9001]` — anything not on the named scale. */
const RAW_Z_INDEX = /\bz-(\[[^\]]+\]|\d+)/g;

/**
 * Comments, blanked rather than removed so line numbers still line up.
 *
 * Scanned out because the explanations that stop these coming back have to name
 * the class they are warning about — including the one on this very rule.
 */
function withoutComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // Stories are demo harnesses, not shipped chrome: one of them positions a
      // mock rail with a raw index and that is nobody's layering decision.
      if (entry === "stories") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|stories)\.(ts|tsx)$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

describe("the z-index scale", () => {
  test("the shell and its editors use only the named layers", () => {
    const offenders: string[] = [];
    for (const dir of GUARDED) {
      for (const file of sourceFiles(dir)) {
        const contents = withoutComments(readFileSync(file, "utf-8"));
        for (const match of contents.matchAll(RAW_Z_INDEX)) {
          const line = contents.slice(0, match.index).split("\n").length;
          offenders.push(
            `${file.slice(__dirname.length + 1)}:${line} uses ${match[0]} —` +
              ` pick z-hover / z-window / z-full / z-overlay instead`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
