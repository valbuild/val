import fs from "fs";
import path from "path";

/**
 * The package root must be importable by a browser.
 *
 * `@valbuild/ui` is the reason. The Studio builds a project in the tab, so it
 * imports this package's root entrypoint — and a browser bundle that reaches a
 * `node:` builtin, or `rolldown`, or TanStack's route generator, does not fail
 * at the import. It fails at whatever bundler the app happens to use, in the
 * app's own build, with a message about a polyfill. That is a long way from
 * here.
 *
 * So the split is enforced rather than intended: everything that needs Node
 * lives under `src/node/` behind the `/node` subpath, and this walks the root's
 * import graph to prove nothing down there is reachable from up here.
 *
 * A static walk over `import`/`export ... from`, which is enough because that
 * is the only way anything in this package reaches anything else in it. It also
 * catches a dynamic `import()` of a literal specifier, which is how the route
 * generator is loaded and exactly the kind of thing that would slip through a
 * dependency-list check.
 */

const SRC = __dirname;

/**
 * The code, with everything that is not this package's own imports removed.
 *
 * Two things had to go, and both are specific to what this package is.
 *
 * Comments, because it documents itself with examples and several of them are
 * import statements — `import styles from './styles.css?url'`,
 * `import Button from '@/components/Button'` — describing what a USER's project
 * may write.
 *
 * Template literals, because this package GENERATES code: `wire.ts` emits a
 * project's `val.server.ts`, whose imports (`../../val.config`,
 * `@valbuild/tanstack/server`) are the wired project's, not this file's. They
 * are still a template literal at this point, and scanning one finds a relative
 * path that resolves against the wrong repository entirely.
 *
 * Losing an `import()` that lives inside a template literal costs nothing: its
 * specifier is interpolated, so there was no literal to follow.
 *
 * Whole-line `//` comments only. A trailing `//` is left alone because
 * stripping it means deciding whether the `//` is inside a string, and
 * `'https://…'` appears here more often than a trailing comment containing an
 * import does.
 */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function scannable(code: string): string {
  return withoutComments(code).replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``");
}

/** Every `from "..."` and `import("...")` specifier in a file. */
function specifiersOf(source: string): string[] {
  const code = scannable(source);
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

/** Where a relative specifier lands, or null if it is a bare one. */
function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`${from} imports '${specifier}', which resolves to nothing.`);
}

type Reached = { file: string; via: string[] };

/** Every file the entry reaches, with the path that got there. */
function reachableFrom(entry: string): Map<string, Reached> {
  const reached = new Map<string, Reached>();
  const queue: Reached[] = [{ file: entry, via: [entry] }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reached.has(current.file)) continue;
    reached.set(current.file, current);
    const code = fs.readFileSync(current.file, "utf8");
    for (const specifier of specifiersOf(code)) {
      const resolved = resolveRelative(current.file, specifier);
      if (resolved && !reached.has(resolved)) {
        queue.push({ file: resolved, via: [...current.via, resolved] });
      }
    }
  }
  return reached;
}

const relative = (file: string) => path.relative(SRC, file);
const trail = (entry: Reached) => entry.via.map(relative).join(" -> ");

/**
 * Bare specifiers a browser cannot have.
 *
 * `node:` covers the builtins whatever the import style. The three packages are
 * named because they are the heavy Node-only ones the `/node` half exists to
 * hold — an accidental import of any of them is the failure this guards, and
 * naming them says which.
 */
const NODE_ONLY = [
  "rolldown",
  "rolldown/parseAst",
  "@tanstack/router-generator",
  "@tanstack/router-plugin",
];

describe("the package root is browser-safe", () => {
  const reached = reachableFrom(path.join(SRC, "index.ts"));

  test("nothing under node/ is reachable from the root entrypoint", () => {
    const nodeDir = path.join(SRC, "node") + path.sep;
    const leaked = [...reached.values()].filter((entry) =>
      entry.file.startsWith(nodeDir),
    );
    expect(leaked.map(trail)).toEqual([]);
  });

  test("nothing the root reaches imports a Node builtin or bundler", () => {
    const offenders: string[] = [];
    for (const entry of reached.values()) {
      const code = fs.readFileSync(entry.file, "utf8");
      for (const specifier of specifiersOf(code)) {
        const nodeOnly =
          specifier.startsWith("node:") || NODE_ONLY.includes(specifier);
        if (nodeOnly) {
          offenders.push(`${relative(entry.file)} imports '${specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the walk actually walked something", () => {
    // Without this, a resolver that silently found nothing would make the two
    // tests above pass by reaching one file.
    expect(reached.size).toBeGreaterThan(10);
  });
});

describe("the /node entrypoint is the other half", () => {
  test("it reaches the Node-only code the root may not", () => {
    const reached = reachableFrom(path.join(SRC, "node", "index.ts"));
    const files = [...reached.keys()].map(relative);
    // If this ever fails, the two tests above have stopped meaning anything:
    // they would be proving the root does not reach code that is not there.
    expect(files).toContain(path.join("node", "vendorLayer.ts"));
    expect(files).toContain(path.join("node", "routes.ts"));
  });
});

/**
 * A `file://` URL must never reach a bare `import()`.
 *
 * Rollup rewrites a dynamic `import(x)` in the CommonJS build to `require(x)`,
 * and `require` does not take a `file://` URL. So `await import(pathToFileURL(…))`
 * builds fine, ships fine, and fails at the moment a project first uses a
 * Tailwind plugin or route splitting — with "Cannot find module", naming a file
 * that is plainly there. It shipped exactly once, and only the end-to-end loop
 * caught it. `dynamicImport` is the way to load one; see its own file.
 *
 * A bare specifier is deliberately NOT caught here: `require("@tanstack/router-
 * generator")` and `require("node:fs")` are things Node answers, and routing
 * those through the helper would resolve them against the process's working
 * directory instead of against the module asking.
 *
 * Source-level rather than a check on the built output, because the failure is
 * in code the build emits from these lines, and a test that had to build the
 * package would not run here.
 */
describe("loading a module by path", () => {
  test("no `file://` URL reaches a bare import()", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(path.join(SRC, "node"))) {
      // The helper's whole job is to hold the one `import()` that takes a URL,
      // and it holds it as a string the bundler cannot see.
      if (!file.endsWith(".ts") || file === "dynamicImport.ts") continue;
      const code = withoutComments(
        fs.readFileSync(path.join(SRC, "node", file), "utf8"),
      );
      for (const match of code.matchAll(/\bimport\s*\(([^)]*\)?[^)]*)\)/g)) {
        const argument = match[1] ?? "";
        if (/pathToFileURL|file:\/\//.test(argument)) {
          offenders.push(
            `node/${file}: import(${argument.trim().slice(0, 60)})`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
