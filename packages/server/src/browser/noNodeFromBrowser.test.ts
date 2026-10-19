import fs from "fs";
import path from "path";
import { builtinModules } from "module";

/**
 * `@valbuild/server/browser` must be bundleable for a browser.
 *
 * The demo runs Val's real server in the tab (`docs/plans/demo-mode.md`), and a
 * browser bundle that reaches a Node builtin does not fail here. It fails in
 * the app's build, with a message about a polyfill, or at runtime in a
 * visitor's tab. So the split is enforced rather than intended: this walks the
 * entry's import graph and fails, naming the chain, if a builtin becomes
 * reachable.
 *
 * If this fails on code you just wrote: the module you imported from the
 * request handlers reaches Node. Either keep the Node part where it was (a
 * mode's own `ValOps`, or `nodePlatform`) and reach it through
 * `ValServerPlatform`, or use what `posixPath` does instead of `path`. A
 * dynamic `import()` does NOT fix it -- a bundler follows those too, which is
 * why this counts them.
 *
 * Type-only imports are skipped, because they are erased: that is how
 * `ValServer` names `ValOpsFS` and `ValOpsHttp` without loading them.
 */

const SRC = path.resolve(__dirname, "..");
const ENTRY = path.join(SRC, "browser", "index.ts");

function scannable(code: string): string {
  return (
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
      // `import type { X } from "./x"` and `export type { X } from "./x"`.
      .replace(/\b(?:import|export)\s+type\b[^;]*?\bfrom\s*["'][^"']+["']/g, "")
  );
}

function specifiersOf(source: string): string[] {
  const code = scannable(source);
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

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

const BUILTINS = new Set(builtinModules);
/**
 * Not a builtin, but server-only all the same: it embeds the Studio's built
 * bundle so a Node server can serve it, and the page in the browser already
 * loaded that bundle.
 */
const SERVER_ONLY = ["@valbuild/ui/server"];

/**
 * Builtins with a package of the same name that a browser bundle resolves
 * instead. `buffer` is a declared dependency of this package for exactly that
 * reason: Node answers it with its own, a bundler with the package.
 */
const BROWSER_PACKAGES = ["buffer"];

function isNodeOnly(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (BROWSER_PACKAGES.includes(specifier)) return false;
  if (SERVER_ONLY.includes(specifier)) return true;
  return BUILTINS.has(specifier.split("/")[0] ?? specifier);
}

describe("@valbuild/server/browser is browser-safe", () => {
  const reached = reachableFrom(ENTRY);

  test("nothing it reaches imports a Node builtin", () => {
    const offenders: string[] = [];
    for (const entry of reached.values()) {
      const code = fs.readFileSync(entry.file, "utf8");
      for (const specifier of specifiersOf(code)) {
        if (isNodeOnly(specifier)) {
          offenders.push(`'${specifier}' via ${trail(entry)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("it reaches the real server, not a stand-in", () => {
    // If this fails, the test above has stopped meaning anything: it would be
    // proving that a small file does not import `fs`.
    const files = [...reached.keys()].map(relative);
    expect(files).toContain("ValServer.ts");
    expect(files).toContain("ValRouterCore.ts");
    expect(files).toContain("ValOpsMemory.ts");
    expect(files).toContain("ValOps.ts");
  });

  test("the Node entry is the other half", () => {
    // The split is only real if the Node-only code still exists, reached from
    // the package's main entry instead.
    const files = [...reachableFrom(path.join(SRC, "index.ts")).keys()].map(
      relative,
    );
    expect(files).toContain("nodePlatform.ts");
    expect(files).toContain("ValOpsFS.ts");
    expect(files).not.toContain(path.join("browser", "browserPlatform.ts"));
  });
});
