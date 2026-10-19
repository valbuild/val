import { build } from "@rolldown/browser";
import type { BuildTarget } from "./contract";
import { dirname, resolve, resolveInFiles } from "./paths";
import { aliasMap } from "./tsconfigPaths";

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
}): Promise<{ code: string }> {
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

  const resolveProjectPath = (path: string) => resolveInFiles(path, files);
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
          resolveId(source: string, importer: string | undefined) {
            if (source.startsWith(".")) {
              return resolveProjectPath(
                resolve(dirname(importer ?? entry), source),
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
  const chunks = result.output.filter(
    (output): output is Extract<typeof output, { type: "chunk" }> =>
      output.type === "chunk",
  );
  if (chunks.length !== 1) {
    throw new Error(
      `Bundling the Val modules made ${chunks.length} chunks rather than one.`,
    );
  }
  return { code: chunks[0]!.code };
}
