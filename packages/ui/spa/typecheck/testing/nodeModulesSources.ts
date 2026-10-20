import * as fs from "node:fs";
import * as path from "node:path";
import {
  SourceError,
  type PackageRef,
  type TypecheckSources,
  type TypesBundle,
} from "../acquireTypes";

/**
 * Bundles and compilers cut from an installed `node_modules/.pnpm`, the way
 * adept cuts them from tarballs (`bundles.rs`): every `.d.ts`, `.d.cts`,
 * `.d.mts` and `package.json` as text, and the JavaScript files by name.
 * Node only: for tests, and for the parity script when no adept is running.
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

/** The slot directories in a virtual store, by the name of their package. */
function slotsByName(
  store: string,
): Map<string, { version: string; dir: string }[]> {
  const byName = new Map<string, { version: string; dir: string }[]>();
  for (const slot of fs.readdirSync(store)) {
    const at = slot.indexOf("@", 1);
    if (at < 0) continue;
    const name = slot.slice(0, at).replace("+", "/");
    const version = slot.slice(at + 1).split("_")[0]!;
    const dir = path.join(store, slot, "node_modules", name);
    if (!fs.existsSync(dir)) continue;
    let slots = byName.get(name);
    if (!slots) byName.set(name, (slots = []));
    slots.push({ version, dir });
  }
  return byName;
}

export function nodeModulesSources(
  root: string,
  options: { anyVersion?: boolean; fallbackRoots?: string[] } = {},
): TypecheckSources {
  const roots = [root, ...(options.fallbackRoots ?? [])];
  const stores = roots.map((dir) =>
    slotsByName(path.join(dir, "node_modules", ".pnpm")),
  );
  const find = (name: string, version: string) => {
    for (const store of stores) {
      const slots = store.get(name) ?? [];
      const exact = slots.find((slot) => slot.version === version);
      if (exact) return exact.dir;
      if (options.anyVersion && slots[0]) return slots[0].dir;
    }
    return null;
  };
  return {
    async types(pkg: PackageRef) {
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
    async compiler(version: string) {
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
