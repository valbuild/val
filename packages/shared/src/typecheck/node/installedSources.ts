import * as fs from "node:fs";
import * as path from "node:path";
import {
  SourceError,
  type PackageRef,
  type TypecheckSources,
  type TypesBundle,
} from "../acquireTypes";
import type { CompilerBundle } from "../typescriptCompiler";

/**
 * Bundles and compilers cut from a project's installed `node_modules`, the
 * way adept cuts them from tarballs (`bundles.rs`): every `.d.ts`, `.d.cts`,
 * `.d.mts` and `package.json` as text, and the JavaScript files by name.
 *
 * For a build that has just installed the project anyway -- the dependency
 * layer is built from that install -- so the typecheck asks adept for
 * nothing. The check itself is `typecheckProject`, the same one the Studio
 * and the upgrade page run with `adeptSources`: only where the declarations
 * come from differs.
 *
 * A package is found by what its own `package.json` says, not by the name of
 * the directory it is in: pnpm shortens a long virtual-store directory name
 * to a hash, and a hoisted install has no virtual store at all.
 *
 * `anyVersion` serves whatever version of a package is installed, for tests
 * whose fixture names versions this repository does not have: they are about
 * which packages are fetched and where they land, not about their contents.
 */
const DECLARATION = /\.d\.[mc]?ts$/;
const SCRIPT = /\.[mc]?js$/;

function cut(packageDir: string): TypesBundle {
  const files: Record<string, string> = {};
  const stubs: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(packageDir, dir), {
      withFileTypes: true,
    })) {
      const relative = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(relative);
      } else if (entry.isFile()) {
        if (DECLARATION.test(entry.name) || entry.name === "package.json") {
          files[relative] = fs.readFileSync(
            path.join(packageDir, relative),
            "utf8",
          );
        } else if (SCRIPT.test(entry.name)) {
          stubs.push(relative);
        }
      }
    }
  };
  walk("");
  return { files, stubs: stubs.sort() };
}

type Installed = { version: string; dir: string };

/** `name` and `version` from a package directory's own manifest. */
function manifestOf(dir: string): { name: string; version: string } | null {
  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    if (
      typeof manifest === "object" &&
      manifest !== null &&
      "name" in manifest &&
      typeof manifest.name === "string" &&
      "version" in manifest &&
      typeof manifest.version === "string"
    ) {
      return { name: manifest.name, version: manifest.version };
    }
  } catch {
    // Not a package, or not one that can be read: not installed, as far as
    // the typecheck can tell.
  }
  return null;
}

/** Whether `file` is a directory, following a link to one. */
function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The package directories in a `node_modules`, scoped ones under their scope.
 * Links are followed: pnpm's global virtual store links a project's slots
 * into a store shared by every project on the machine.
 */
function packageDirsIn(modulesDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(modulesDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const dir = path.join(modulesDir, name);
    if (!isDirectory(dir)) continue;
    if (name.startsWith("@")) out.push(...packageDirsIn(dir));
    else out.push(dir);
  }
  return out;
}

/**
 * Every package installed under `root`, by name: what is in each slot of
 * pnpm's virtual store, and what is in `node_modules` itself, which is where
 * a hoisted install puts everything. A package reached by several links is
 * one package, at its real path.
 */
function installedUnder(root: string): Map<string, Installed[]> {
  const byName = new Map<string, Installed[]>();
  const seen = new Set<string>();
  const add = (linked: string) => {
    let dir: string;
    try {
      dir = fs.realpathSync(linked);
    } catch {
      return;
    }
    if (seen.has(dir)) return;
    seen.add(dir);
    const manifest = manifestOf(dir);
    if (manifest === null) return;
    let found = byName.get(manifest.name);
    if (!found) byName.set(manifest.name, (found = []));
    found.push({ version: manifest.version, dir });
  };
  const modules = path.join(root, "node_modules");
  const store = path.join(modules, ".pnpm");
  let slots: string[];
  try {
    slots = fs.readdirSync(store);
  } catch {
    slots = [];
  }
  for (const slot of slots) {
    if (slot === "node_modules" || slot.startsWith(".")) continue;
    for (const dir of packageDirsIn(path.join(store, slot, "node_modules"))) {
      add(dir);
    }
  }
  for (const dir of packageDirsIn(modules)) add(dir);
  return byName;
}

export function installedSources(
  root: string,
  options: { anyVersion?: boolean; fallbackRoots?: string[] } = {},
): TypecheckSources {
  const roots = [root, ...(options.fallbackRoots ?? [])];
  let stores: Map<string, Installed[]>[] | null = null;
  const find = (name: string, version: string) => {
    // Read on the first request rather than when made: a source nobody asks
    // costs nothing.
    stores ??= roots.map(installedUnder);
    for (const store of stores) {
      const found = store.get(name) ?? [];
      const exact = found.find((installed) => installed.version === version);
      if (exact) return exact.dir;
      if (options.anyVersion && found[0]) return found[0].dir;
    }
    return null;
  };
  return {
    async types(pkg: PackageRef): Promise<TypesBundle> {
      const dir = find(pkg.name, pkg.version);
      if (dir === null) {
        throw new SourceError(
          `${pkg.name}@${pkg.version} is not installed here.`,
          "not-found",
          false,
          404,
        );
      }
      return cut(dir);
    },
    async compiler(version: string): Promise<CompilerBundle> {
      if (Number(version.split(".")[0]) >= 7) {
        throw new SourceError(
          `typescript@${version} has no JavaScript compiler.`,
          "no-js-compiler",
          false,
          422,
        );
      }
      const dir = find("typescript", version);
      if (dir === null) {
        throw new SourceError(
          `typescript@${version} is not installed here.`,
          "not-found",
          false,
          404,
        );
      }
      const lib = path.join(dir, "lib");
      const files: Record<string, string> = {
        "lib/typescript.js": fs.readFileSync(
          path.join(lib, "typescript.js"),
          "utf8",
        ),
      };
      for (const entry of fs.readdirSync(lib)) {
        if (/^lib\..*\.d\.ts$|^lib\.d\.ts$/.test(entry)) {
          files[`lib/${entry}`] = fs.readFileSync(
            path.join(lib, entry),
            "utf8",
          );
        }
      }
      return { version, files };
    },
  };
}
