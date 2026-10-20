import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import {
  computePnpmLayout,
  createMatcher,
  depPathToFilename,
  layoutOptionsOfWorkspace,
  type PnpmLayout,
} from "./pnpmLayout";
import { parsePnpmLockfile } from "./pnpmLockfile";
import { sha256Hex } from "./sha256";

/**
 * Each fixture is what a real `pnpm install --frozen-lockfile
 * --ignore-scripts` (pnpm 12.14.0, linux x64 glibc) left on disk, read by
 * `testing/makeLayoutFixture.ts`:
 *
 * - `template-tanstack-minimal`: valbuild/template-tanstack-minimal at
 *   b7440d3, 863 packages before platform filtering.
 * - `workspace`: three importers with `workspace:*` links, an npm alias
 *   (`strip: npm:strip-ansi@6.0.1`), `chalk` 4 at the root and 5 in a
 *   package, `debug` 2 and 4, an upper-case name (`JSONStream`), `esbuild`'s
 *   platform packages and `fsevents`, which Linux skips.
 * - `hoist-patterns`: `publicHoistPattern: ["*types*"]` and `hoistPattern:
 *   ["*", "!ms"]` in `pnpm-workspace.yaml`.
 */
const FIXTURES = ["template-tanstack-minimal", "workspace", "hoist-patterns"];

type Installed = {
  workspaceNames: Record<string, string>;
  links: Record<string, string>;
  packages: string[];
};

function isInstalled(value: unknown): value is Installed {
  return (
    typeof value === "object" &&
    value !== null &&
    "links" in value &&
    "packages" in value &&
    "workspaceNames" in value
  );
}

function loadFixture(name: string): {
  layout: PnpmLayout;
  installed: Installed;
} {
  const dir = path.join(__dirname, "fixtures", name);
  const lockfile = parsePnpmLockfile(
    fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"),
  );
  const workspacePath = path.join(dir, "pnpm-workspace.yaml");
  const workspace: unknown = fs.existsSync(workspacePath)
    ? parse(fs.readFileSync(workspacePath, "utf8"))
    : {};
  const installed: unknown = JSON.parse(
    fs.readFileSync(path.join(dir, "installed.json"), "utf8"),
  );
  if (!isInstalled(installed)) throw new Error(`${name}: not a fixture`);
  const layout = computePnpmLayout(lockfile, {
    ...layoutOptionsOfWorkspace(
      typeof workspace === "object" && workspace !== null
        ? Object.fromEntries(Object.entries(workspace))
        : {},
    ),
    workspaceNames: installed.workspaceNames,
  });
  return { layout, installed };
}

/**
 * The packages reachable from a file in `dir` by name, as Node finds them:
 * each `node_modules` from `dir` up, nearest first. Every entry is either a
 * symlink or a slot's own package directory.
 */
function visibleFrom(
  links: Iterable<[string, string]>,
  packages: Iterable<string>,
  dir: string,
): Record<string, string> {
  const byModulesDir = new Map<string, Map<string, string>>();
  const add = (entry: string, target: string) => {
    const parts = entry.split("/node_modules/");
    const name = parts.pop()!;
    const modulesDir = `${parts.join("/node_modules/")}/node_modules`;
    let names = byModulesDir.get(modulesDir);
    if (!names) byModulesDir.set(modulesDir, (names = new Map()));
    names.set(name, target);
  };
  for (const [link, target] of links) add(link, target);
  for (const packageDir of packages) add(packageDir, packageDir);
  const seen: Record<string, string> = {};
  for (let at = dir; ; at = path.posix.dirname(at)) {
    const modulesDir = at === "/" ? "/node_modules" : `${at}/node_modules`;
    for (const [name, target] of byModulesDir.get(modulesDir) ?? []) {
      if (!(name in seen)) seen[name] = target;
    }
    if (at === "/") return seen;
  }
}

const computedFrom = (layout: PnpmLayout, dir: string) =>
  visibleFrom(layout.links, layout.packages.keys(), dir);
const installedFrom = (installed: Installed, dir: string) =>
  visibleFrom(Object.entries(installed.links), installed.packages, dir);

describe("the layout pnpm install makes", () => {
  describe.each(FIXTURES)("%s", (name) => {
    const { layout, installed } = loadFixture(name);

    test("has every symlink pnpm made, pointing where pnpm pointed it", () => {
      expect(Object.fromEntries(layout.links)).toEqual(installed.links);
    });

    test("has a directory for every package pnpm installed, and no other", () => {
      expect([...layout.packages.keys()].sort()).toEqual(installed.packages);
    });

    test("each importer sees what it sees on disk", () => {
      for (const dir of layout.importers.values()) {
        expect(computedFrom(layout, `${dir}/src`)).toEqual(
          installedFrom(installed, `${dir}/src`),
        );
      }
    });

    test("each package sees what it sees on disk", () => {
      for (const dir of layout.packages.keys()) {
        expect(computedFrom(layout, `${dir}/lib`)).toEqual(
          installedFrom(installed, `${dir}/lib`),
        );
      }
    });
  });

  test("a project file sees only what its importer declares, and a package its own dependencies and the hoist", () => {
    const { layout } = loadFixture("workspace");
    const root = computedFrom(layout, "/project/src");
    expect(root["chalk"]).toBe(
      "/project/node_modules/.pnpm/chalk@4.1.2/node_modules/chalk",
    );
    // The root does not declare debug, so it does not see it.
    expect(root["debug"]).toBeUndefined();
    // An npm alias is linked under the alias, at the aliased package.
    expect(root["strip"]).toBe(
      "/project/node_modules/.pnpm/strip-ansi@6.0.1/node_modules/strip-ansi",
    );
    const a = computedFrom(layout, "/project/packages/a/src");
    expect(a["chalk"]).toBe(
      "/project/node_modules/.pnpm/chalk@5.3.0/node_modules/chalk",
    );
    expect(a["b"]).toBe("/project/packages/b");
    // Inside a package: its own dependencies first, then the private hoist.
    const send = [...layout.packages].find(([, p]) => p.name === "send")![0];
    const fromSend = computedFrom(layout, `${send}/lib`);
    expect(fromSend["debug"]).toMatch(
      /^\/project\/node_modules\/\.pnpm\/debug@2\.6\.9[_/]/,
    );
    expect(fromSend["a"]).toBe("/project/packages/a");
  });

  test("leaves out optional packages for another platform, and what only they reach", () => {
    const { layout } = loadFixture("workspace");
    expect([...layout.skipped].some((key) => key.startsWith("fsevents@"))).toBe(
      true,
    );
    expect(
      [...layout.packages.values()].some(
        (p) => p.name === "@esbuild/linux-x64",
      ),
    ).toBe(true);
    expect(
      [...layout.packages.values()].some(
        (p) => p.name === "@esbuild/darwin-arm64",
      ),
    ).toBe(false);
  });

  test("installs every optional package when there is no platform", () => {
    const dir = path.join(__dirname, "fixtures", "workspace");
    const lockfile = parsePnpmLockfile(
      fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"),
    );
    const layout = computePnpmLayout(lockfile, { platform: null });
    expect(layout.skipped.size).toBe(0);
    expect(layout.packages.size).toBe(Object.keys(lockfile.snapshots).length);
  });
});

describe("depPathToFilename", () => {
  // The cases of pnpm's `dep_path_to_filename/tests.rs`.
  test.each([
    ["foo@1.0.0", "foo@1.0.0"],
    ["@scope/foo@1.0.0", "@scope+foo@1.0.0"],
    ["foo@1.0.0(bar@2.0.0)(baz@3.0.0)", "foo@1.0.0_bar@2.0.0_baz@3.0.0"],
    ["file:packages/foo", "file+packages+foo"],
    ["file:Pkg", "file+Pkg"],
    [
      "eslint-plugin-testing-library@7.7.0(eslint@9.35.0(jiti@2.6.1))(typescript@6.0.3)",
      "eslint-plugin-testing-library@7.7.0_eslint@9.35.0_jiti@2.6.1__typescript@6.0.3",
    ],
    ["", ""],
    ["a", "a"],
    [
      "parent-pkg@file:..",
      "parent-pkg@file+++_3cf6176c884f1541b42906b711973e2d",
    ],
  ])("%s", (depPath, filename) => {
    expect(depPathToFilename(depPath, 120)).toBe(filename);
  });

  test("a name longer than the limit is cut and given a hash of the whole", () => {
    const got = depPathToFilename(`foo@1.0.0${"(bar@2.0.0)".repeat(40)}`, 60);
    expect(got).toHaveLength(60);
    expect(got.slice(-33)).toMatch(/^_[0-9a-f]{32}$/);
  });

  test("upper case is hashed, so that a case-insensitive disk keeps names apart", () => {
    const got = depPathToFilename("FOO@1.0.0", 120);
    expect(got.startsWith("FOO@1.0.0_")).toBe(true);
    expect(got).toHaveLength("FOO@1.0.0_".length + 32);
  });
});

describe("sha256Hex", () => {
  test.each([
    "",
    "abc",
    "@tanstack+react-start-rsc@0.1.59_esbuild@0.28.2_react-dom@19.3.0",
    "ä".repeat(100),
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(64),
    "x".repeat(1000),
  ])("is Node's SHA-256 of %j", (text) => {
    expect(sha256Hex(text)).toBe(
      createHash("sha256").update(text, "utf8").digest("hex"),
    );
  });
});

describe("createMatcher", () => {
  test("matches pnpm's hoist patterns", () => {
    expect(createMatcher([])("a")).toBe(false);
    expect(createMatcher(["*"])("@types/node")).toBe(true);
    expect(createMatcher(["*types*"])("@types/node")).toBe(true);
    expect(createMatcher(["*types*"])("react")).toBe(false);
    expect(createMatcher(["!ms"])("ms")).toBe(false);
    expect(createMatcher(["!ms"])("debug")).toBe(true);
    const mixed = createMatcher(["*", "!ms", "m?"]);
    expect(mixed("ms")).toBe(true);
    expect(createMatcher(["*", "!ms"])("ms")).toBe(false);
    expect(createMatcher(["*", "!ms"])("debug")).toBe(true);
  });
});

describe("layoutOptionsOfWorkspace", () => {
  test("reads the hoist settings", () => {
    expect(
      layoutOptionsOfWorkspace({ hoist: false, shamefullyHoist: true }),
    ).toEqual({ hoistPattern: [], publicHoistPattern: ["*"] });
  });

  test("refuses a layout it cannot follow, and says which setting", () => {
    expect(() => layoutOptionsOfWorkspace({ nodeLinker: "hoisted" })).toThrow(
      /nodeLinker/,
    );
  });
});
