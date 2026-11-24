// Loading a JS module for Tailwind's `@plugin` / `@config`.
//
// Tailwind resolves and executes these while compiling CSS. The builder cannot:
// it has no module resolution, only a fixed set of externals. In CI there is a
// real filesystem and a real node_modules, so this is the straightforward case
// -- resolve from the project root and import it.
//
// The project root, not this package's: a plugin is the project's dependency
// and its version is whatever the project's lockfile pinned, exactly like the
// vendor layer.
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CssModuleLoader, LoadedCssModule } from "../build";
import { dynamicImport } from "./dynamicImport";

export function cssModuleLoader(dir: string): CssModuleLoader {
  // Absolute: the dir arrives however the caller spelled it, and createRequire
  // rejects a relative path.
  const root = resolve(dir);
  const require = createRequire(join(root, "package.json"));

  return async (id, base, hint) => {
    // `base` is a project path: `/` is the project root (see
    // `compileTailwind`), and the build has already made every relative id
    // relative to it. Resolving from `base` as it was -- the root of the
    // DISK -- is how `@config "../tailwind.config.js"` could never be found.
    const from = join(root, base);
    const isRelative = id.startsWith("./") || id.startsWith("../");
    let resolved: string;
    try {
      resolved = require.resolve(id, { paths: [from] });
    } catch {
      throw new Error(
        isRelative
          ? // Not the id as Tailwind has it: the build made it relative to
            // the project root, which is not what the stylesheet says. The
            // file it ended up naming is what is worth saying.
            `Tailwind's @${hint} names a file that does not exist: there is no ` +
              `'${relative(root, join(from, id))}' in the project. A path in @${hint} is ` +
              `relative to the stylesheet it is written in; fix the path, or remove the directive.`
          : `Tailwind's '@${hint} "${id}"' names a package that is not installed in the project. ` +
              `Add '${packageName(id)}' to package.json and install, or remove the directive.`,
      );
    }

    // Default export when there is one: Tailwind plugins are written as
    // `export default plugin(...)`, and a namespace would not be callable.
    //
    // The assertion is where "what shape is this" stops being answerable here:
    // it is the project's own module, loaded by path at runtime. Tailwind
    // validates what it gets.
    const loaded = (await dynamicImport(pathToFileURL(resolved).href)) as {
      default?: LoadedCssModule;
    } & LoadedCssModule;
    // `path` was missing until this package moved somewhere that type-checks
    // it. Tailwind reads it to attribute what a plugin contributes, and it had
    // been getting `undefined`.
    return {
      path: resolved,
      base: dirname(resolved),
      module: loaded.default ?? loaded,
    };
  };
}

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`. */
function packageName(id: string): string {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}
