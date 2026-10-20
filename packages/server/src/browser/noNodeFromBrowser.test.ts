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
 *
 * The walk goes on into `@valbuild/core` and `@valbuild/shared`, because they
 * are in the tab too: what they import is as much a part of the demo's chunk
 * as what this package does.
 */

const SRC = path.resolve(__dirname, "..");
const PACKAGES = path.resolve(SRC, "..", "..");
const ENTRY = path.join(SRC, "browser", "index.ts");

/**
 * The workspace packages the server imports, mapped to the source of the entry
 * each specifier names. Their own `package.json` maps the same specifiers to
 * `dist/`, which is what an app loads; this is the code that becomes it.
 */
const WORKSPACE_ENTRIES: Record<string, string> = {
  "@valbuild/core": path.join(PACKAGES, "core", "src", "index.ts"),
  "@valbuild/core/fp": path.join(PACKAGES, "core", "src", "fp", "index.ts"),
  "@valbuild/core/patch": path.join(
    PACKAGES,
    "core",
    "src",
    "patch",
    "index.ts",
  ),
  "@valbuild/shared": path.join(PACKAGES, "shared", "src", "index.ts"),
  "@valbuild/shared/internal": path.join(
    PACKAGES,
    "shared",
    "src",
    "internal",
    "index.ts",
  ),
};

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

function withoutStrings(code: string): string {
  return code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
}

const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(source: string, dynamic = true): string[] {
  const code = scannable(source);
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    ...(dynamic ? [DYNAMIC_IMPORT] : []),
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
  const workspaceEntry = WORKSPACE_ENTRIES[specifier];
  if (workspaceEntry) return workspaceEntry;
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

function reachableFrom(entry: string, dynamic = true): Map<string, Reached> {
  const reached = new Map<string, Reached>();
  const queue: Reached[] = [{ file: entry, via: [entry] }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reached.has(current.file)) continue;
    reached.set(current.file, current);
    const code = fs.readFileSync(current.file, "utf8");
    for (const specifier of specifiersOf(code, dynamic)) {
      const resolved = resolveRelative(current.file, specifier);
      if (resolved && !reached.has(resolved)) {
        queue.push({ file: resolved, via: [...current.via, resolved] });
      }
    }
  }
  return reached;
}

const relative = (file: string) =>
  file.startsWith(SRC + path.sep)
    ? path.relative(SRC, file)
    : path.relative(PACKAGES, file);
const trail = (entry: Reached) => entry.via.map(relative).join(" -> ");

const BUILTINS = new Set(builtinModules);
/**
 * Not a builtin, but server-only all the same: it embeds the Studio's built
 * bundle so a Node server can serve it, and the page in the browser already
 * loaded that bundle.
 */
const SERVER_ONLY = ["@valbuild/ui/server"];

/*
 * `buffer` is a builtin like the rest, and is refused like the rest, although
 * npm has a package of that name a bundler can resolve instead. That package is
 * CommonJS, and `vite dev` serves a dependency it did not see in its scan
 * unconverted: the demo's chunk is loaded on demand, so the scan never sees it,
 * and the tab refuses the import with "does not provide an export named
 * 'Buffer'". `vite build` converts it, so only an app's dev server broke. Use
 * `Uint8Array` and `./bytes` instead.
 */

function isNodeOnly(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
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

  test("nothing it reaches uses Node's global Buffer", () => {
    // The import is caught above; this is the same thing without one. A
    // browser has no `Buffer`, so a value use is a ReferenceError in the tab,
    // and a type use says bytes have methods (`toString("base64")`) that a
    // `Uint8Array` from the browser does not. Bytes are `Uint8Array` here.
    const offenders: string[] = [];
    for (const entry of reached.values()) {
      const code = withoutStrings(
        scannable(fs.readFileSync(entry.file, "utf8")),
      );
      if (/\bBuffer\b/.test(code)) {
        offenders.push(trail(entry));
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
    expect(files).toContain(path.join("core", "src", "index.ts"));
    expect(files).toContain(path.join("shared", "src", "internal", "index.ts"));
  });

  test("the TypeScript compiler is loaded only when it is used", () => {
    // Not a correctness rule like the one above: a size one. The compiler is
    // most of the server's weight -- the demo's in-tab chunk was 3.6 MB with
    // it -- and only publishing and the history reader use it, so they import
    // it dynamically and a bundler splits it off (`patch/ts/publishKit.ts`).
    // A static import of it anywhere below the entry puts it back.
    const offenders: string[] = [];
    for (const entry of reachableFrom(ENTRY, false).values()) {
      const code = fs.readFileSync(entry.file, "utf8");
      if (specifiersOf(code, false).includes("typescript")) {
        offenders.push(trail(entry));
      }
    }
    expect(offenders).toEqual([]);
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
