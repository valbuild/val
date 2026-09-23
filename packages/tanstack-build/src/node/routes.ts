// Route tree generation, for file-based projects.
//
// `spike/routegen` proved the generator runs in a *browser*, over a plain
// object of files, which is what the studio needs. In CI there is a real
// filesystem and real node_modules, so this is the straightforward case: point
// TanStack's own generator at the directory and let it write the tree.
//
// Kept here rather than in `packages/verify` because it is a Node-only
// dependency, and verify is meant to stay callable from anywhere -- it takes a
// `generateRouteTree` callback for exactly this reason.
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * The project's own route-generator config.
 *
 * `tsr.config.json` is what TanStack's standalone CLI reads, and a project that
 * needs it needs it here too. The starter template is the case in point: it
 * keeps content modules beside route files (`products.$sku.val.ts` serves
 * `products.$sku.tsx`), and without its `routeFileIgnorePattern` the generator
 * reads that as a route at `/products/$sku/val`.
 *
 * Only the keys that change what is generated are honoured; output shape stays
 * this platform's, because the builder consumes it.
 */
const HONOURED = [
  "routeFileIgnorePattern",
  "routeFileIgnorePrefix",
  "routesDirectory",
  "indexToken",
  "routeToken",
  "pathParamsAllowedCharacters",
] as const;

async function projectRouterConfig(dir: string) {
  for (const name of ["tsr.config.json"]) {
    try {
      const parsed = JSON.parse(
        await readFile(join(dir, name), "utf8"),
      ) as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const key of HONOURED) if (key in parsed) kept[key] = parsed[key];
      return kept;
    } catch {
      /* absent or unreadable; the defaults below are fine */
    }
  }
  return {};
}

/** A project is file-based if it has a routes directory. */
export async function isFileBased(dir: string) {
  return stat(join(dir, "src", "routes")).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
}

/**
 * The one line the platform needs from a file-based project.
 *
 * `src/app.tsx` is the entry the builder looks for, and for a routes-as-data
 * project the user writes it. A file-based project has no such file -- its
 * entry *is* the generated tree -- so this bridges the two contracts. A real
 * integration would emit it rather than ask for it, which is what this is.
 */
export const ENTRY_SHIM = `export { routeTree } from './routeTree.gen'\n`;

/**
 * Generates `routeTree.gen.ts` and returns the file map with it (and the entry
 * shim) added.
 *
 * The generator's only interface is the filesystem, so this does write into the
 * project -- and then puts it back exactly as it was. An earlier version left
 * the file there, on the reasoning that the tree "is normally gitignored and
 * regenerated, so writing it is not a surprise". That is false often enough to
 * matter: `valbuild/template-tanstack-starter` *tracks* its `routeTree.gen.ts`,
 * and running `pnpm report:project` against a checkout of it silently rewrote a
 * committed file with different formatting and no eslint header. Inspecting a
 * project should not modify it, least of all one the caller only pointed at.
 *
 * Only the in-memory copy is used for the build, so nothing needs the file to
 * survive. A developer who wants it on disk runs `tsr generate`, which is the
 * command that is supposed to produce it.
 */
export async function generateRouteTree(
  dir: string,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  // A bare specifier, so an ordinary `import()` and not `dynamicImport`: the
  // CJS build turns this into `require("@tanstack/router-generator")`, which
  // Node answers, and the helper would resolve the name against the process's
  // working directory instead of against this module. See dynamicImport.ts.
  const { Generator } = await import("@tanstack/router-generator");
  const projectConfig = await projectRouterConfig(dir);

  // Absolute, because the generator resolves `routesDirectory` and
  // `generatedRouteTree` against `root` when they are relative -- and we build
  // both by joining `dir`, which is also `root`. A relative `dir` therefore
  // doubles the prefix: `pnpm report:project templates/kitchen-sink` wrote its
  // tree to `templates/kitchen-sink/templates/kitchen-sink/src/`, found no
  // routes at the doubled path, and generated nothing, silently.
  //
  // This was latent for a long time. The read below happened to succeed because
  // a correct tree from some earlier absolute-path run was still lying in the
  // project, so every relative-path publish quietly consumed a STALE tree. The
  // restore added above deletes that file, which is what finally surfaced it as
  // a PLATFORM301 on the next run.
  const root = resolve(dir);

  const generator = new Generator({
    root,
    config: {
      routesDirectory: join(root, "src", "routes"),
      generatedRouteTree: join(root, "src", "routeTree.gen.ts"),
      routeFileIgnorePrefix: "-",
      quoteStyle: "single",
      semicolons: false,
      disableLogging: true,
      routeTreeFileHeader: [],
      routeTreeFileFooter: [],
      indexToken: "index",
      routeToken: "route",
      enableRouteTreeFormatting: false,
      // `verboseFileRoutes: true` was here and is gone. The object was cast to
      // `any` on the way into the constructor, which is what let it stay: the
      // key is not in the generator's config -- not in its types and not
      // anywhere in its dist -- so it had been inert for however long. The cast
      // is gone with it, so the next key that stops existing is a type error.
      // The builder strips types anyway, and the generated declarations are by
      // far the largest part of the file.
      disableTypes: true,
      addExtensions: false,
      // Not the plugin's auto-splitting, which is a separate transform this
      // platform does not run. `.lazy.tsx` still works: the generator expresses
      // it as an `import()`, which the builder splits.
      autoCodeSplitting: false,
      experimental: {},
      plugins: [],
      tmpDir: join(root, ".tanstack", "tmp"),
      target: "react",
      pathParamsAllowedCharacters: [],
      // The generator's default, spelled out because its config type is the
      // POST-defaults one and so requires every key. It was being supplied by
      // zod all along; the cast is what stopped the compiler saying so.
      importRoutesUsingAbsolutePaths: false,
      // Last, so the project's own choices win over the defaults above.
      ...projectConfig,
    },
  });

  // What was there before, so it can go back. `null` means there was no file,
  // and the restore is a delete.
  const treePath = join(root, "src", "routeTree.gen.ts");
  const before = await readFile(treePath, "utf8").catch(() => null);
  const tanstackDir = join(root, ".tanstack");
  const hadTanstackDir = await stat(tanstackDir).then(
    () => true,
    () => false,
  );

  let tree: string;
  try {
    await generator.run();
    tree = await readFile(treePath, "utf8");
  } finally {
    // In `finally` so a generator that throws half-way through does not leave a
    // truncated tree in someone's working copy either.
    if (before === null) await rm(treePath, { force: true });
    else await writeFile(treePath, before);
    if (!hadTanstackDir)
      await rm(tanstackDir, { recursive: true, force: true });
  }

  return {
    ...files,
    "src/routeTree.gen.ts": tree,
    // Only when the project has not written its own.
    "src/app.tsx": files["src/app.tsx"] ?? ENTRY_SHIM,
  };
}
