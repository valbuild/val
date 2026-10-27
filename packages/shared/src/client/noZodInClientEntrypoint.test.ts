import fs from "fs";
import path from "path";

/**
 * `@valbuild/shared/client` exists so that `@valbuild/next`'s client code can
 * read a string constant without a browser downloading zod.
 *
 * Preconstruct publishes each entrypoint as ONE bundled module, so this is not
 * a preference that a bundler can partially honour: the moment anything
 * reachable from `client/index.ts` imports zod, every visitor to every Val site
 * pays ~113 KB for it again, and nothing else in CI would notice.
 *
 * The walk is over the source graph rather than the built `dist`, so this fails
 * on the commit that introduces the import rather than at release time.
 */
const SRC = path.resolve(__dirname, "..");
const ENTRY = path.join(SRC, "client", "index.ts");

const FORBIDDEN = ["zod", "zod-validation-error"];

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** Every `from "..."` specifier in a file, type-only imports included. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

describe("@valbuild/shared/client", () => {
  test("reaches no zod, directly or transitively", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const walk = (file: string, trail: string[]) => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      const source = fs.readFileSync(file, "utf-8");
      for (const spec of importSpecifiers(source)) {
        if (FORBIDDEN.includes(spec) || spec.startsWith("zod/")) {
          offenders.push(
            [...trail, path.relative(SRC, file), `→ ${spec}`].join(" → "),
          );
          continue;
        }
        const resolved = resolveImport(file, spec);
        if (resolved) {
          walk(resolved, [...trail, path.relative(SRC, file)]);
        }
      }
    };
    walk(ENTRY, []);

    expect(seen.size).toBeGreaterThan(1); // the walk actually traversed
    expect(offenders).toEqual([]);
  });
});
