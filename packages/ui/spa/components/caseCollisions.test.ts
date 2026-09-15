import { readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Two files in one directory whose names differ only in case.
 *
 * On Linux that is two files. On macOS and on Windows — which is what the
 * Studio is developed on — it is ONE, and which of the two an import resolves
 * to is not something you get to choose. `StudioTour.tsx` and `studioTour.ts`
 * were both real, and `import { TourLauncher } from "./StudioTour"` resolved to
 * the wrong one:
 *
 *     Uncaught SyntaxError: The requested module
 *     '/api/val/static/spa/components/shell/StudioTour.ts' does not provide an
 *     export named 'TourLauncher'
 *
 * The Studio did not come up at all. Nothing caught it: CI is Linux, the e2e
 * suite runs on Linux, and every unit test here passed — the collision is
 * invisible on the platform everything is verified on, and fatal on the one
 * everything is written on. That asymmetry is the whole reason this is a test
 * rather than a convention.
 *
 * The whole SPA rather than one directory: the rule is about the filesystem,
 * and nothing about it is specific to the shell.
 */
const ROOT = join(__dirname, "..");

/** Directories not worth walking. */
const SKIP = new Set(["node_modules", "dist", ".next", "__snapshots__"]);

/** Every directory under `dir`, itself included. */
function directories(dir: string): string[] {
  const found = [dir];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...directories(path));
    }
  }
  return found;
}

/** Extensions an extensionless import resolves to. */
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * What `./Something` could mean, for one directory entry.
 *
 * The entry's own name, because two entries with the same name cannot both
 * exist on a case-insensitive filesystem at all — one of them simply is not
 * there after a checkout. And, for anything an import can resolve to, the name
 * WITHOUT its extension: that is the form an import is written in, and it is
 * the one that bit. Comparing whole names misses it, because `StudioTour.tsx`
 * and `studioTour.ts` do differ — in the extension.
 *
 * A directory counts, since `./foo` can mean `foo/index.ts`.
 */
function resolvableAs(name: string, isDirectory: boolean): string[] {
  if (isDirectory) return [name];
  const extension = MODULE_EXTENSIONS.find((candidate) =>
    name.endsWith(candidate),
  );
  return extension === undefined
    ? [name]
    : [name, name.slice(0, -extension.length)];
}

/**
 * Entries in one directory that an import could confuse, as readable pairs.
 *
 * Exported so the rule can be exercised on a fixture rather than only on a tree
 * that is expected to be clean — a guard that has never been seen to fail is a
 * guard nobody knows the failure mode of.
 */
export function caseCollisions(
  entries: readonly { name: string; isDirectory: boolean }[],
): string[] {
  /**
   * Lowercased key -> the actual keys seen under it, and the entries they came
   * from.
   *
   * Both halves, because only one kind of clash is this test's business. A
   * directory `Search` beside a file `Search.tsx` also gives two ways to read
   * `./Search` — but that ambiguity is resolved identically on every platform
   * (the file wins), so it is a thing to know rather than a bug, and it is
   * already in the tree and working. What breaks is when the two keys differ
   * ONLY in case: then the filesystem, not the resolver, decides.
   */
  const byKey = new Map<string, { keys: Set<string>; names: Set<string> }>();
  for (const entry of entries) {
    for (const key of resolvableAs(entry.name, entry.isDirectory)) {
      const lower = key.toLowerCase();
      const group = byKey.get(lower) ?? { keys: new Set(), names: new Set() };
      group.keys.add(key);
      group.names.add(entry.name);
      byKey.set(lower, group);
    }
  }
  const pairs = new Set<string>();
  for (const { keys, names } of byKey.values()) {
    if (keys.size > 1) {
      pairs.add([...names].sort().join(" and "));
    }
  }
  return [...pairs].sort();
}

describe("file names", () => {
  test("nothing in the SPA differs only by case", () => {
    const offenders: string[] = [];
    for (const dir of directories(ROOT)) {
      const entries = readdirSync(dir).map((name) => ({
        name,
        isDirectory: statSync(join(dir, name)).isDirectory(),
      }));
      for (const collision of caseCollisions(entries)) {
        offenders.push(
          `${dir.slice(ROOT.length + 1) || "."}: ${collision} —` +
            ` one module on macOS and Windows, so an import resolves to` +
            ` whichever the platform picks. Rename one.`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  const files = (...names: string[]) =>
    names.map((name) => ({ name, isDirectory: false }));

  test("catches the pair that broke the Studio", () => {
    expect(caseCollisions(files("StudioTour.tsx", "studioTour.ts"))).toEqual([
      "StudioTour.tsx and studioTour.ts",
    ]);
  });

  // The same name twice cannot even be checked out on those filesystems.
  test("catches two entries that differ only in case", () => {
    expect(caseCollisions(files("Readme.md", "readme.md"))).toEqual([
      "Readme.md and readme.md",
    ]);
  });

  test("catches a directory and a module whose names differ only in case", () => {
    expect(
      caseCollisions([
        { name: "shell", isDirectory: true },
        { name: "Shell.tsx", isDirectory: false },
      ]),
    ).toEqual(["Shell.tsx and shell"]);
  });

  /**
   * A directory and a same-cased module beside it is NOT this bug. `./Search`
   * means `Search.tsx` on every platform — the resolver decides, not the
   * filesystem — and the SPA has exactly that pair today, working.
   */
  test("leaves a directory and a same-cased module alone", () => {
    expect(
      caseCollisions([
        { name: "Search", isDirectory: true },
        { name: "Search.tsx", isDirectory: false },
      ]),
    ).toEqual([]);
  });

  test("names that merely share a stem are fine", () => {
    expect(
      caseCollisions(
        files("Shell.tsx", "Shell.test.tsx", "Shell.stories.tsx", "index.css"),
      ),
    ).toEqual([]);
  });
});
