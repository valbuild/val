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
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CssModuleLoader, LoadedCssModule } from "../build";
import { dynamicImport } from "./dynamicImport";

export function cssModuleLoader(dir: string): CssModuleLoader {
  // Absolute: the dir arrives however the caller spelled it, and createRequire
  // rejects a relative path.
  const require = createRequire(join(resolve(dir), "package.json"));

  return async (id, base, hint) => {
    let resolved: string;
    try {
      resolved = require.resolve(id, { paths: [base, dir] });
    } catch {
      throw new Error(
        `Tailwind's '@${hint} "${id}"' could not be resolved from the project. ` +
          `Add it to package.json and install, or remove the directive.`,
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
