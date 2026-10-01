import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import type { BuildTarget, PublishArtifact } from "@valbuild/tanstack-build";
import type { VendorLayer } from "@valbuild/tanstack-build/node";

/**
 * `val publish`'s build: the site, built from the checkout, as the artifacts
 * the publish API takes (valbuild/home, docs/app-mode.md, "Briefing:
 * val-publish" and "Flow B").
 *
 * The same builder the Studio runs in a tab -- `@valbuild/tanstack-build` --
 * plus the half a tab cannot run: the project's dependency layer, built from
 * its own `node_modules` (`@valbuild/tanstack-build/node`). So a CI checkout
 * and a Studio build of the same content produce the same site, and the layer
 * is the one thing only this side can make.
 *
 * Against content's build target, never the loader's: content is the only
 * address a publisher has, and it answers what the platform expects.
 *
 * Written to a directory, and then published by the upload path `val publish
 * --artifacts` has always had: one path for bytes to leave by, whoever built
 * them.
 */

/** What `val publish` hands on to the upload. */
export type BuiltArtifacts =
  | {
      status: "built";
      /** A directory of artifacts, laid out as `--artifacts` reads them. */
      dir: string;
      buildHash: string;
      linksOwnCss: boolean;
      /**
       * The layer by name, when content already holds it and it was not
       * written; `null` when the project declares nothing beyond the base set.
       * `undefined` when the layer artifact is in `dir`, which names it.
       */
      layerRev?: string | null;
      warnings: string[];
    }
  | { status: "error"; message: string };

type TanstackBuild = typeof import("@valbuild/tanstack-build");
type TanstackBuildNode = typeof import("@valbuild/tanstack-build/node");

/**
 * The builder, loaded only when a build is asked for: it brings rolldown's
 * native binary with it, and `val validate` has no use for one.
 */
async function loadBuilder(): Promise<
  | { status: "ok"; build: TanstackBuild; node: TanstackBuildNode }
  | { status: "error"; message: string }
> {
  try {
    const [build, node] = await Promise.all([
      import("@valbuild/tanstack-build"),
      import("@valbuild/tanstack-build/node"),
    ]);
    return { status: "ok", build, node };
  } catch (e) {
    return {
      status: "error",
      message:
        "`val publish` builds the site with @valbuild/tanstack-build and rolldown, and " +
        `they could not be loaded: ${e instanceof Error ? e.message : String(e)}\n\n` +
        "Install them in the project:\n\n" +
        "    npm install --save-dev @valbuild/tanstack-build rolldown @tanstack/router-generator @tanstack/router-plugin\n\n" +
        "or publish a build made elsewhere with --artifacts <dir>.",
    };
  }
}

/**
 * Never the project's own files, at any depth: installed packages. Dot
 * directories (`.git`, `.tanstack`, `.val`, `.output`) are tooling too.
 */
const IGNORED_DIRS = new Set(["node_modules"]);

/**
 * Build output, at the project's root only: `src/routes/build/` is a route
 * called "build", not a previous build.
 */
const ROOT_OUTPUT_DIRS = new Set(["dist", "build"]);

/** Lockfiles are JSON, and nothing imports them. */
const ROOT_LOCKFILES = new Set(["package-lock.json"]);

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|css)$/;

/**
 * JSON is the project's too: `tsconfig.json` and `tsr.config.json` are read
 * by the build, a `.val.json` holds a `.jsonValues()` entry no import points
 * at, and a module may import one -- the starter's `val.server.ts` imports
 * `.prettierrc.json`, which is also why a dot FILE is read.
 */
const JSON_FILE = /\.json$/;

/**
 * The project's own files: its source as text, and the binaries it imports
 * (an image, a font) base64, as `BuildInput.assets` takes them. `public/` is
 * neither: it is served as is, and read by `readPublicFiles`.
 */
export function readProjectFiles(
  root: string,
  isAsset: (path: string) => boolean,
): { sources: Record<string, string>; assets: Record<string, string> } {
  const sources: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name))
          continue;
        if (dir === root && ROOT_OUTPUT_DIRS.has(entry.name)) continue;
        if (dir === root && entry.name === "public") continue;
        walk(full);
        continue;
      }
      const key = path.relative(root, full).split(path.sep).join("/");
      if (CODE_FILE.test(entry.name)) {
        sources[key] = fs.readFileSync(full, "utf8");
      } else if (JSON_FILE.test(entry.name)) {
        if (!ROOT_LOCKFILES.has(key)) {
          sources[key] = fs.readFileSync(full, "utf8");
        }
      } else if (isAsset(key)) {
        assets[key] = fs.readFileSync(full).toString("base64");
      }
    }
  };
  walk(root);
  return { sources, assets };
}

/** Files under `public/`, base64, keyed `public/<path>` as the build takes them. */
export function readPublicFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const base = path.join(root, "public");
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const key = path.relative(root, full).split(path.sep).join("/");
        out[key] = fs.readFileSync(full).toString("base64");
      }
    }
  };
  walk(base);
  return out;
}

/** The project's build-time variables: `PUBLIC_*` reach the browser, by the builder's rule. */
function publicEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("PUBLIC_") && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The target, with this project's layer as built here rather than as content
 * last stored it: a build has to link against the layer it ships with.
 */
export function targetWithLayer(
  target: BuildTarget,
  layer: VendorLayer | null,
): BuildTarget {
  return {
    ...target,
    project: {
      ...target.project,
      rev: layer?.rev ?? null,
      modules: layer?.modules ?? {},
      css: layer?.css ?? {},
      workerOnly: layer?.workerOnly ?? [],
    },
  };
}

function writeArtifact(dir: string, key: string, body: string | Buffer) {
  const file = path.join(dir, ...key.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

export async function buildArtifacts(options: {
  root: string;
  target: BuildTarget;
  /** The project, as the platform names it; only for the wiring's record. */
  project: string;
  /** Content, which is the platform as far as this publisher knows. */
  contentHost: string;
  /** The commit this checkout is at, and the branch it publishes. */
  git: { commit: string; branch: string } | null;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** Where to write; a fresh temporary directory by default. */
  outDir?: string;
}): Promise<BuiltArtifacts> {
  const log = options.log ?? (() => {});
  const loaded = await loadBuilder();
  if (loaded.status === "error") return loaded;
  const { build: builder, node } = loaded;
  const { root, target } = options;
  const warnings: string[] = [];

  try {
    /*
     * Wired for the platform at publish time, as the Studio's builds are: the
     * wired `val.server.ts` reads its files from a module the BUILD emits, so
     * no checkout can carry it. `rebakeGit` would be the tab's spelling of the
     * same thing for a record that is already wired.
     */
    const { sources: onDisk, assets } = readProjectFiles(root, builder.isAsset);
    const wiring =
      builder.isValProject(onDisk) && !builder.isWired(onDisk)
        ? builder.wireUp(onDisk, {
            project: options.project,
            loader: options.contentHost,
            ...(options.git ? { git: options.git } : {}),
          })
        : null;
    // Less the one about the layer, which is the thing this goes on to build.
    warnings.push(
      ...(wiring?.warnings ?? []).filter(
        (warning) => !warning.includes("dependency layer built for it"),
      ),
    );
    const sources = wiring?.files ?? onDisk;

    // The dependency layer: from what the project imports, of what it declares.
    log("Building the dependency layer");
    const manifest: { dependencies?: Record<string, string> } = (() => {
      try {
        return JSON.parse(sources["package.json"] ?? "{}");
      } catch {
        return {};
      }
    })();
    const deps = node.layerDepsOf(manifest, sources);
    const css = await node.collectDependencyCss(
      root,
      node.cssSpecifiersOf(sources),
    );
    const layer = await node.buildVendorLayer(root, deps, css, {
      base: target.base,
      // A project on the platform layers its own copies; only the platform's
      // own checkout carries pinned ones.
      resolvePlatformModule: () => null,
      // No built base layer here: the export audit is skipped, not failed.
      baseLayerDir: null,
    });

    log("Building the site");
    const fileBased = await node.isFileBased(root);
    const files = fileBased
      ? await node.generateRouteTree(root, sources)
      : sources;
    /*
     * The project's copy of the splitter first, then the one beside this CLI
     * -- where a package manager puts an optional peer the project installed
     * but did not hoist. Neither is a build that does not split, which costs
     * size and not behaviour.
     */
    const splitter =
      (await node.routeSplitter(root)) ??
      (typeof __dirname === "string"
        ? await node.routeSplitter(__dirname)
        : null);
    if (splitter === null) {
      warnings.push(
        "Routes are not code-split: @tanstack/router-plugin is not installed.",
      );
    }
    const built = await builder.buildUserApp({
      files,
      target: targetWithLayer(target, layer),
      env: publicEnv(options.env ?? process.env),
      publicFiles: readPublicFiles(root),
      assets,
      // The project's own files, without the generated tree: what the next
      // publish -- the Studio's included -- starts from.
      projectSource: sources,
      loadCssModule: node.cssModuleLoader(root),
      ...(splitter ? { routeSplitter: splitter } : {}),
      rsc: target.project.rsc,
    });
    const artifacts: PublishArtifact[] = await builder.publishArtifacts(built, {
      projectSource: sources,
    });

    const dir =
      options.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "val-publish-"));
    for (const artifact of artifacts) {
      writeArtifact(dir, artifact.key, artifact.body);
    }
    /*
     * The layer: sent when content does not hold this one, named when it
     * does. The rev is a digest of the built chunks, so "content has this" is
     * a fact rather than a hope.
     */
    let layerRev: string | null | undefined;
    if (layer === null) layerRev = null;
    else if (layer.rev === target.project.rev) layerRev = layer.rev;
    else writeArtifact(dir, "layer", zlib.gzipSync(JSON.stringify(layer)));

    return {
      status: "built",
      dir,
      buildHash: built.hash,
      linksOwnCss: built.linksOwnCss,
      ...(layerRev !== undefined ? { layerRev } : {}),
      warnings,
    };
  } catch (e) {
    return {
      status: "error",
      message: `The site could not be built: ${
        e instanceof Error ? e.message.split("\n")[0] : String(e)
      }`,
    };
  }
}
