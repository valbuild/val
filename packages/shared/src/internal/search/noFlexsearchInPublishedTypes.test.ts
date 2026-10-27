import fs from "fs";
import path from "path";
import FlexSearch from "flexsearch";
import { SearchIndex, createSearchIndex } from "./searchIndex";

/**
 * flexsearch must not appear in this package's published type declarations.
 *
 * `declare module "flexsearch"` is what flexsearch's own `index.d.ts` opens
 * with, and an ambient module declaration is global to a TypeScript program.
 * So a `.d.ts` of ours that merely NAMES flexsearch pulls that declaration into
 * every consumer's program — and a consumer with its own flexsearch at another
 * version then type-checks its OWN calls against whichever of the two copies
 * wins.
 *
 * The incident: `@valbuild/shared` gained flexsearch in 0.123.0 for
 * `search_content`, and `SearchIndex.index` was typed as flexsearch's `Index`,
 * so `searchIndex.d.ts` shipped `import { Index } from "flexsearch"`. On
 * 0.123.2 valbuild/web stopped building — it pins flexsearch 0.7 and calls
 * `new flexsearch.Document({ language: "en", … })`, and 0.8's `DocumentOptions`
 * has no `language`. Its own resolved copy was still 0.7; only the types had
 * been swapped underneath it. Same shape as the `@types/react` duplication in
 * CLAUDE.md, and the same lesson as the zod leak that
 * `noZodInClientEntrypoint.test.ts` guards.
 *
 * Two things are checked, because either alone would miss the regression:
 * that no source file names flexsearch in a type position, and that the
 * structural type standing in for `Index` still describes the real library.
 */
const SRC = path.resolve(__dirname, "..", "..");

/** Every `.ts`/`.tsx` file under `packages/shared/src`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("flexsearch in @valbuild/shared's types", () => {
  /**
   * One reviewed way to name flexsearch: a default VALUE import.
   *
   * That form is erased from the declarations, because the binding is only ever
   * called inside a function body. Every other way of naming the module reaches
   * the `.d.ts` — a named or type-only import (how `Index` arrived), a
   * re-export (`export { Index } from`, `export * from`), or a type query
   * (`import("flexsearch")`).
   *
   * So rather than enumerate the bad forms, the allowed one is stripped and
   * anything still naming the module is an offender. Enumerating was the first
   * attempt and it missed the re-exports and the type query.
   */
  test("is named only by a default value import", () => {
    const files = sourceFiles(SRC).filter(
      (file) => !file.endsWith("noFlexsearchInPublishedTypes.test.ts"),
    );
    expect(files.length).toBeGreaterThan(20); // the walk found the package

    /** `import FlexSearch from "flexsearch"` — a bare default binding. */
    const ALLOWED = /import\s+[A-Za-z_$][\w$]*\s+from\s*["']flexsearch["']/g;
    /**
     * flexsearch in a MODULE SPECIFIER position.
     *
     * Anchored on `from` / `import(` / `require(` rather than on the bare word,
     * so prose may still discuss it: `searchIndex.ts` explains this very rule
     * in a comment that quotes `declare module "flexsearch"`, and that is
     * preceded by `module`, not by any of these.
     */
    const SPECIFIER =
      /(?:\bfrom\b|\bimport\s*\(|\brequire\s*\()\s*["']flexsearch["']/g;

    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf-8");
      const stripped = source.replace(ALLOWED, "");
      for (const m of stripped.matchAll(SPECIFIER)) {
        offenders.push(`${path.relative(SRC, file)}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The stripping has to actually be load bearing.
   *
   * A typo in `ALLOWED` that made it match nothing would leave the real default
   * import as an offender and fail the test above; a typo that made it match
   * everything would pass it no matter what. This pins the middle: the allowed
   * form is accepted, and each of the four leaking forms is caught.
   */
  test("catches every form that reaches a .d.ts", () => {
    // Built per call: `test` on a /g/ regex carries `lastIndex` between calls,
    // so a shared one would answer differently depending on call order.
    const leaks = (source: string): boolean => {
      const allowed = /import\s+[A-Za-z_$][\w$]*\s+from\s*["']flexsearch["']/g;
      const specifier =
        /(?:\bfrom\b|\bimport\s*\(|\brequire\s*\()\s*["']flexsearch["']/g;
      return specifier.test(source.replace(allowed, ""));
    };

    expect(leaks('import FlexSearch from "flexsearch";')).toBe(false);
    expect(leaks('// see declare module "flexsearch" for why')).toBe(false);

    expect(leaks('import { Index } from "flexsearch";')).toBe(true);
    expect(leaks('import type { Index } from "flexsearch";')).toBe(true);
    expect(leaks('export { Index } from "flexsearch";')).toBe(true);
    expect(leaks('export * from "flexsearch";')).toBe(true);
    expect(leaks('type I = import("flexsearch").Index;')).toBe(true);
    expect(leaks('const f = require("flexsearch");')).toBe(true);
  });

  /**
   * And the stand-in has to keep describing the real thing.
   *
   * Structural types go stale silently: flexsearch could rename `remove` and
   * nothing else here would fail, because no call site is checked against the
   * library any more. Assigning a real `Index` to the exported field is what
   * catches that — the same trick `sharpImageProcessor.test.ts` uses to stop
   * `SharpLike` drifting from sharp.
   */
  test("stands in for a real flexsearch Index", () => {
    const real = new FlexSearch.Index({ tokenize: "forward" });
    // Fails to compile if `SearchableIndex` asks for anything `Index` lacks.
    const index: SearchIndex["index"] = real;

    // And is the same shape the module actually builds for itself.
    expect(typeof createSearchIndex().index.add).toBe("function");

    // Exercised, not just assigned: a signature can be satisfied by a type and
    // still be the wrong call.
    index.add("a/path", "hello world");
    expect(index.search("hello", { limit: 10 })).toEqual(["a/path"]);
    index.remove("a/path");
    expect(index.search("hello", { limit: 10 })).toEqual([]);
  });
});
