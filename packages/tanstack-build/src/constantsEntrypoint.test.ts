import fs from "fs";
import path from "path";

/**
 * `@valbuild/tanstack-build/constants` must import nothing that does work.
 *
 * It exists for callers that cannot afford the root: the root reaches
 * `@rolldown/browser`, whose loader fetches 10.9 MB of wasm when it is
 * evaluated, and the platform's route generator bundle and content's publish
 * handler each need four strings. A convenience import added to one of these
 * modules would put the bundler back in both of them, and neither would fail --
 * one would get 1.3 MB heavier and the other would load a WASI runtime at boot.
 *
 * So the whole graph under the entrypoint is walked, and every module in it
 * must import only other modules in it. Relative imports only, and none that
 * leave the three files this is made of.
 */

const SRC = __dirname;

function importsOf(file: string): string[] {
  const code = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    // `ENTRY_SHIM` is a line of GENERATED code, `from './routeTree.gen'`, and
    // it is the project's import rather than this module's.
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``");
  const found: string[] = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ]) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

function resolve(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${specifier} from ${from} does not resolve to a .ts file`);
}

describe("the constants entrypoint", () => {
  test("reaches only modules that import nothing but each other", () => {
    const entry = path.join(SRC, "constants", "index.ts");
    const seen = new Set<string>();
    const pending = [entry];
    const outside: string[] = [];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith(".")) {
          outside.push(`${path.relative(SRC, file)} imports ${specifier}`);
          continue;
        }
        pending.push(resolve(file, specifier));
      }
    }
    expect(outside).toEqual([]);
    expect([...seen].map((file) => path.relative(SRC, file)).sort()).toEqual([
      "artifactKeys.ts",
      path.join("constants", "index.ts"),
      "projectPaths.ts",
    ]);
  });
});
