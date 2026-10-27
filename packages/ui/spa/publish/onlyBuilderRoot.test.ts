import fs from "fs";
import path from "path";

/**
 * The Studio reaches `@valbuild/tanstack-build`'s ROOT, from one place.
 *
 * The other half of `noNodeFromBrowser.test.ts` in that package, which proves
 * the root's own import graph stays browser-safe. This proves the Studio never
 * asks for anything else -- the two together are what keep the split real.
 *
 * `/node` reads `node_modules` and shells out to the native bundler. Importing
 * it from here would not fail here: it would fail in whatever bundler the
 * consuming app uses, in that app's own build, with a message about polyfilling
 * `node:fs`. That is a long way from this file.
 *
 * And ONE import site, because loading the builder must be replaceable: nothing
 * that imports it for real can run under jest, so every test of what the Studio
 * does with a builder goes through `setBuilderLoader`. A second `import()`
 * somewhere else would be a path no test could reach and no fake could stand in
 * for.
 */

const SPA = path.join(__dirname, "..");
const PACKAGE = "@valbuild/tanstack-build";

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * A file with its comments gone.
 *
 * This directory documents itself with the package's name in prose, and a
 * docblock saying "never import `@valbuild/tanstack-build/node`" would
 * otherwise be read as an import of it -- which would make the test fail on the
 * sentence warning against the thing it forbids. Stripped FIRST, so the type
 * strip below cannot see a `from` that is part of an English sentence either.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * `import type` / `export type` declarations, gone.
 *
 * What may sit between `type` and `from` is a binding list -- identifiers,
 * braces, commas, `*`, `as`. So the gap excludes `;` and quotes, and that is
 * the whole of why this is safe: without it the lazy match runs past the end of
 * a `export type X = Y;` that has no `from` at all and swallows everything up
 * to the next quoted string anywhere in the file. That is not hypothetical --
 * it ate this module's own dynamic import and made the count below read zero.
 *
 * Erring towards NOT stripping is the safe direction: an unstripped type import
 * is counted as a load site, and a test that fails is a test somebody reads.
 */
function withoutTypeImports(source: string): string {
  return source.replace(
    /\b(?:import|export)\s+type\s+[^;"'`]*?\bfrom\s*["'][^"']+["']/g,
    "",
  );
}

/**
 * The specifiers a file reaches AT RUNTIME.
 *
 * Type imports are stripped, and only for the one-site rule below. A type
 * import is erased by the compiler: it loads nothing, so there is no second
 * path for a test to be unable to reach and nothing for `setBuilderLoader` to
 * be unable to stand in for. Counting one would make declaring
 * `PublishArtifact` in a second file look like a second way to load 10.9 MB of
 * WebAssembly, which it is not.
 *
 * The SUBPATH rule below does not use this, deliberately: a type import from
 * `@valbuild/tanstack-build/node` is erased too, but it says somebody meant to
 * use the Node half from the Studio, and that is worth failing over while it
 * is still only a type.
 */
function runtimeSpecifiersOf(file: string): string[] {
  return specifiersIn(
    withoutTypeImports(withoutComments(fs.readFileSync(file, "utf8"))),
  );
}

function specifiersOf(file: string): string[] {
  return specifiersIn(withoutComments(fs.readFileSync(file, "utf8")));
}

function specifiersIn(code: string): string[] {
  const found: string[] = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /*
     * `import "pkg"` -- no `from`, so the first pattern does not see it.
     * Verified by adding exactly that line to a second file in this directory
     * and watching the count test go from passing to failing; without it, the
     * one shape that most looks like a stray import was the one shape this
     * could not find.
     */
    /\bimport\s*["']([^"']+)["']/g,
  ]) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

describe("the Studio's reach into the builder package", () => {
  const files = sourceFiles(SPA);

  test("the walk actually walked something", () => {
    // Without this, a glob that found nothing would make both tests below pass
    // by having no files to disagree with.
    expect(files.length).toBeGreaterThan(100);
  });

  test("never reaches a subpath, only the root", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of specifiersOf(file)) {
        if (specifier.startsWith(`${PACKAGE}/`)) {
          offenders.push(`${path.relative(SPA, file)} imports '${specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("and LOADS the root from exactly one file", () => {
    const sites: string[] = [];
    for (const file of files) {
      for (const specifier of runtimeSpecifiersOf(file)) {
        if (specifier === PACKAGE) {
          sites.push(path.relative(SPA, file));
        }
      }
    }
    // `loadBuilder.ts` holds the dynamic import. Its own `import type` beside
    // it is stripped, so what this counts is the one path that actually loads
    // the package -- moving THAT is what this is here to notice.
    expect([...new Set(sites)]).toEqual([
      path.join("publish", "loadBuilder.ts"),
    ]);
  });
});
