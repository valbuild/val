import { loadRolldown } from "./rolldown";
import type { BuildTarget } from "./contract";
import { dirname, resolve, resolveInFiles } from "./paths";
import { aliasMap } from "./tsconfigPaths";
import { valModulesEntryFile } from "./projectPaths";

/**
 * A project's `val.modules.ts`, bundled to run: every `.val.ts` it imports,
 * the `val.config` they share and the `.val.json` entries they name, as ONE
 * ES module -- so it can be imported from a `blob:` URL, which cannot resolve
 * a relative chunk -- with every npm import pointing at the site's own
 * vendor chunks, at absolute URLs under `origin`.
 *
 * What the builder tab evaluates to learn a tree's schemas: Update from the
 * site with code (valbuild/home `docs/hosted-publishing.md` step 8.2, slice
 * 1b). The project's own `@valbuild/*` and dependencies are what run, as the
 * site runs them -- the browser half of its layer, from `/_pvendor/<rev>/`,
 * and the base layer from `/_vendor/`. Whoever imports it should do so off
 * the Studio's page: `@valbuild/tanstack` brings React and patches its JSX.
 *
 * Nothing else of a build happens here: no route splitting, no server
 * functions, no CSS -- a `.val.ts` has none of it.
 */
export async function bundleValModules(input: {
  /** The tree, by path from the project root. */
  files: Record<string, string>;
  target: BuildTarget;
  /** The site's origin, where its vendor chunks are served. */
  origin: string;
  /** The entry; the project's `val.modules.ts` unless said otherwise. */
  entry?: string;
}): Promise<{
  code: string;
  /**
   * For each module file, every project file it depends on, as this bundle
   * resolved its imports: see {@link moduleDependenciesOf}.
   */
  dependencies: Record<string, string[]>;
}> {
  const { files, target, origin } = input;
  const entry =
    input.entry ??
    ["val.modules.ts", "val.modules.js"].find((path) => path in files);
  if (entry === undefined || !(entry in files)) {
    throw new Error(
      "This project has no val.modules.ts, so its Val modules cannot be read.",
    );
  }
  const warnings: string[] = [];
  const aliases = aliasMap(files, (message) => warnings.push(message));
  const base = `${origin}/_vendor/`;
  const project =
    target.project.rev === null
      ? null
      : `${origin}/_pvendor/${target.project.rev}/`;

  const entryPath: string = entry;
  const resolveProjectPath = (path: string) => resolveInFiles(path, files);
  /** Which project file imports which, as resolved: one edge per import. */
  const imports = new Map<string, Set<string>>();
  const { build } = await loadRolldown();
  let result;
  try {
    result = await build({
      input: entry,
      // See `buildOnce`: required in the browser, inert here.
      cwd: "/",
      moduleTypes: { ".css": "empty" },
      plugins: [
        {
          name: "val:modules",
          resolveId(
            source: string,
            importer: string | undefined,
            extra: { kind?: string },
          ) {
            // The app's code, named and never loaded: left as it is written.
            if (
              extra.kind === "dynamic-import" &&
              isAppCodeImport(source, importer)
            ) {
              return { id: source, external: true };
            }
            const resolved = resolveOne(source, importer);
            // A project file importing a project file: an edge of the graph
            // the dependencies are read from.
            if (
              importer !== undefined &&
              importer in files &&
              typeof resolved === "string" &&
              resolved in files
            ) {
              let from = imports.get(importer);
              if (from === undefined) {
                from = new Set();
                imports.set(importer, from);
              }
              from.add(resolved);
            }
            return resolved;
          },
          load(id: string) {
            return id in files ? files[id] : null;
          },
        },
      ],
      transform: { jsx: { runtime: "automatic", importSource: "react" } },
      output: {
        format: "esm",
        minify: false,
        // One module: `def: () => import("./x.val")` stays a dynamic import of
        // something already in the file.
        codeSplitting: false,
      },
      write: false,
    });
  } catch (error) {
    throw new Error(
      [
        "The Val modules could not be bundled.",
        ...warnings,
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      { cause: error },
    );
  }

  /**
   * Whether a dynamic `import()` in a Val module names the app's own code
   * rather than Val content: the component of
   * `s.object(...).component(() => import("../components/Hero"))`.
   *
   * A `.val.ts` may not import app code, and that thunk is how it names some
   * anyway: it is never called where Val modules are only read, which is
   * here. So the import is left as it stands instead of being followed.
   * Following it would bundle the component and everything it imports - the
   * router, its styles, packages this layer was never asked for - into the
   * module the Studio evaluates, and make every Val module depend on its
   * components' files, so an edit to a component would make its content look
   * like it was "made with code the build does not have".
   *
   * The dynamic imports that ARE content stay: another Val module
   * (`def: () => import("./x.val")`) and a `.jsonValues()` entry
   * (`c.json(() => import("./x.val.json"))`).
   */
  function isAppCodeImport(
    source: string,
    importer: string | undefined,
  ): boolean {
    if (importer === undefined || !/\.val\.(ts|js)$/.test(importer)) {
      return false;
    }
    const resolved = projectFileOf(source, importer);
    return resolved !== null && !/\.val\.(ts|js|json)$/.test(resolved);
  }

  /**
   * The project file an import names, or `null` when it names none: a
   * package of the site's layers, or nothing this project has. By a relative
   * path or through a tsconfig alias, as {@link resolveOne} finds them, and
   * without its errors: this only asks.
   */
  function projectFileOf(source: string, importer: string): string | null {
    if (source.startsWith(".")) {
      return resolveProjectPath(resolve(dirname(importer), source));
    }
    if (source in files) return source;
    if (target.base.modules[source] || target.project.modules[source]) {
      return null;
    }
    if (aliases) {
      for (const candidate of aliases.candidates(source)) {
        const hit = resolveProjectPath(candidate);
        if (hit) return hit;
      }
      const fromBaseUrl = aliases.baseUrlCandidate(source);
      return (fromBaseUrl && resolveProjectPath(fromBaseUrl)) || null;
    }
    return null;
  }

  function resolveOne(
    source: string,
    importer: string | undefined,
  ): string | { id: string; external: true } | null {
    if (source.startsWith(".")) {
      return resolveProjectPath(
        resolve(dirname(importer ?? entryPath), source),
      );
    }
    if (source in files) return source;
    const baseChunk = target.base.modules[source];
    if (baseChunk) {
      return { id: `${base}${baseChunk}.js`, external: true };
    }
    const projectChunk = target.project.modules[source];
    if (projectChunk && project !== null) {
      if (target.project.workerOnly.includes(source)) {
        throw new Error(
          `'${source}' is server-only in this project's vendor layer, so a .val.ts importing it cannot be read in the browser.`,
        );
      }
      return { id: `${project}${projectChunk}.js`, external: true };
    }
    if (aliases) {
      for (const candidate of aliases.candidates(source)) {
        const hit = resolveProjectPath(candidate);
        if (hit) return hit;
      }
      const fromBaseUrl = aliases.baseUrlCandidate(source);
      const hit = fromBaseUrl && resolveProjectPath(fromBaseUrl);
      if (hit) return hit;
    }
    // An error, not a warning: rolldown would otherwise leave the
    // specifier as it is, and it would fail when imported, unnamed.
    throw new Error(
      `'${source}' is not an available dependency. Available: ${[
        ...Object.keys(target.base.modules),
        ...Object.keys(target.project.modules),
      ].join(", ")}.`,
    );
  }
  const chunks = result.output.filter(
    (output): output is Extract<typeof output, { type: "chunk" }> =>
      output.type === "chunk",
  );
  if (chunks.length !== 1) {
    throw new Error(
      `Bundling the Val modules made ${chunks.length} chunks rather than one.`,
    );
  }
  return {
    code: chunks[0]!.code,
    dependencies: moduleDependenciesOf(imports),
  };
}

/**
 * For each module file (`*.val.ts` / `*.val.js`) the graph reaches, every
 * project file it depends on, transitively, sorted: what tells Val's server
 * at a proposal's address that a module whose own file is not staged is of
 * code the build was not made of, through a file it imports
 * (`moduleDependencies`, `stagedAfterBuild` in `@valbuild/server`). From the
 * imports as this bundle resolved them -- relative, tsconfig aliases,
 * whatever resolved -- so it cannot disagree with what the build evaluated.
 * An entry's `.val.json` is left out: it is content, and a record of 10,000
 * entries would make the map that long.
 */
function moduleDependenciesOf(
  imports: ReadonlyMap<string, ReadonlySet<string>>,
): Record<string, string[]> {
  const dependencies: Record<string, string[]> = {};
  const isModule = (path: string) => /\.val\.(ts|js)$/.test(path);
  const isEntry = (path: string) => path.endsWith(".val.json");
  const modules = new Set<string>();
  for (const [from, to] of imports) {
    if (isModule(from)) modules.add(from);
    for (const path of to) if (isModule(path)) modules.add(path);
  }
  for (const module of [...modules].sort()) {
    const seen = new Set<string>();
    const queue = [...(imports.get(module) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (next === module || seen.has(next) || isEntry(next)) continue;
      seen.add(next);
      queue.push(...(imports.get(next) ?? []));
    }
    dependencies[module] = [...seen].sort();
  }
  return dependencies;
}

/**
 * A build's `val.modules` registry, as the build emits it beside its client
 * chunks: `{ "val-modules-<build>.js": code }`, served at `/_app/` with
 * them, its npm imports pointing at the site's vendor chunks on its own
 * origin (`/_vendor/`, `/_pvendor/<rev>/`) as the client bundle's do.
 *
 * What a Studio opened on an older build imports, once the server's
 * manifest names it (`registry`, from the build's name the platform hands
 * the server: `VAL_BUILD`), to take this build's schemas in WITHOUT
 * reloading the page: `HostStore.reloadCode` in `@valbuild/ui`, and phase 9
 * of `docs/plans/one-content-model.md` in valbuild/val.
 *
 * Empty -- and the build goes on -- for a project with no `val.modules.ts`,
 * or one whose Val modules cannot be bundled for the browser (a `.val.ts`
 * importing something server-only): such a build has no entry, and a Studio
 * that cannot import one reloads the page instead, as it did before. Said
 * in the build's warnings.
 */
export async function valModulesEntry(
  input: { files: Record<string, string>; target: BuildTarget },
  build: string,
  warnings: string[],
): Promise<{
  /** The entry, by its file name: none when it could not be made. */
  files: Record<string, string>;
  /**
   * Each module file's project dependencies (see `moduleDependenciesOf`),
   * or `null` when the modules could not be bundled: then nobody can say,
   * and Val's server counts only staged module files.
   */
  dependencies: Record<string, string[]> | null;
}> {
  const entry = ["val.modules.ts", "val.modules.js"].find(
    (path) => path in input.files,
  );
  if (entry === undefined) return { files: {}, dependencies: null };
  try {
    const { code, dependencies } = await bundleValModules({
      files: input.files,
      target: input.target,
      // Root-relative, as the client bundle names its vendor chunks: the
      // entry is served on the site's own origin.
      origin: "",
      entry,
    });
    return { files: { [valModulesEntryFile(build)]: code }, dependencies };
  } catch (error) {
    warnings.push(
      `The Val modules were not emitted for the Studio, so an open Studio reloads the page to take this build's code: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { files: {}, dependencies: null };
  }
}
