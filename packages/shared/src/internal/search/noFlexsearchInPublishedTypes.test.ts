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
   * A default VALUE import is fine — it is erased from the declarations, since
   * it is only ever called inside a function body. A named or type-only import
   * is how the type reaches the `.d.ts`, and `Index` arrived exactly that way.
   */
  test("is imported only as a default value binding", () => {
    const files = sourceFiles(SRC).filter(
      (file) => !file.endsWith("noFlexsearchInPublishedTypes.test.ts"),
    );
    expect(files.length).toBeGreaterThan(20); // the walk found the package

    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf-8");
      // The clause may not itself contain `from`, or the match runs back
      // through every earlier import in the file to reach this one.
      const re =
        /import\s+((?:(?!\bfrom\b)[\s\S])*?)\s+from\s*["']flexsearch["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const clause = m[1].trim();
        // `FlexSearch` — a bare default binding — and nothing else.
        if (!/^[A-Za-z_$][\w$]*$/.test(clause)) {
          offenders.push(`${path.relative(SRC, file)}: import ${clause}`);
        }
      }
      if (
        /import\s+type\s+((?:(?!\bfrom\b)[\s\S])*?)\s+from\s*["']flexsearch["']/.test(
          source,
        )
      ) {
        offenders.push(`${path.relative(SRC, file)}: import type`);
      }
    }
    expect(offenders).toEqual([]);
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
