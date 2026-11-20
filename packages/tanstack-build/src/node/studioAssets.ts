// The Studio's files, served by the platform instead of by the site's server.
//
// `@valbuild/ui/server` answers `/api/val/static/...` from a copy of every
// Studio file embedded in its own source, base64. Loading it costs some
// 80-100 MB of heap, and a Cloudflare isolate has 128 MB: a site whose layer
// carries it is killed for its memory as soon as the Studio asks for a few
// files at once, and every request after waits for a new isolate.
//
// So where the platform serves build assets (`base.buildAssets`), the layer
// is built with `@valbuild/ui/server` replaced by a handler that has no files,
// and the files the replaced module would have served travel with the layer
// as BUILD ASSETS instead: a map from request path to content hash, and the
// bytes, which the publisher uploads once and the platform serves from then
// on. `@valbuild/ui` writes both halves of what is needed for that into its
// package (`static/manifest.json`, `static/files/`; see its `buildStatic.js`),
// so the rules for which path serves which file stay Val's, and nothing here
// re-derives them.
//
// A `@valbuild/ui` from before `static/` has no manifest, and is left alone:
// the layer then carries the embedded copy, as every layer did.

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Plugin } from "rolldown";
import type { BuildAsset, BuildAssets } from "../contract";

/** What a Val app's server answers Val's API under: `initValServer`'s route. */
export const VAL_API_ROUTE = "/api/val";
/** Where `@valbuild/ui/server` is mounted under it. */
export const STUDIO_STATIC_ROUTE = `${VAL_API_ROUTE}/static`;

const UI_SERVER = "@valbuild/ui/server";
const STUB_ID = "\0platform:studio-served-by-platform";

/** `@valbuild/ui`'s `static/manifest.json`, the part read here. */
interface StudioManifest {
  format: number;
  version: string;
  files: Record<string, { sha256: string; size: number; contentType: string }>;
  routes: Record<string, { file: string; cacheControl: string }>;
  fallback: { file: string; cacheControl: string };
}

/** The format this reads. A newer one is refused rather than half understood. */
const MANIFEST_FORMAT = 1;

/** The Studio a build used, found while it resolved `@valbuild/ui/server`. */
export interface StudioFound {
  /** `@valbuild/ui`'s package directory, or null when nothing imported it. */
  root: string | null;
}

/**
 * Replace `@valbuild/ui/server` with a handler that has no files, when the
 * `@valbuild/ui` being imported ships them as files (`static/manifest.json`),
 * and record which `@valbuild/ui` that was.
 *
 * Resolved first, through everything after this plugin, so the package found
 * is the one the import would have bundled -- under pnpm that is a copy in the
 * store that only the importer can see.
 */
export function studioServedByPlatform(found: StudioFound): Plugin {
  return {
    name: "platform:studio-served-by-platform",
    async resolveId(source, importer, extraOptions) {
      if (source !== UI_SERVER) return null;
      const resolved = await this.resolve(source, importer, {
        ...extraOptions,
        skipSelf: true,
      });
      return replacementFor(found, resolved);
    },
    load(id) {
      return loadReplacement(id);
    },
  };
}

/**
 * The plugin's decision, given where `@valbuild/ui/server` resolved to: the
 * replacement's id, recording the package in `found`, or null to bundle the
 * module as it is.
 */
export function replacementFor(
  found: StudioFound,
  resolved: { id: string; external?: boolean | string } | null,
): string | null {
  if (!resolved || resolved.external) return null;
  const root = packageRootOf(resolved.id);
  if (root === null || !existsSync(join(root, "static", "manifest.json"))) {
    return null;
  }
  if (found.root !== null && found.root !== root) {
    throw new Error(
      `Two copies of @valbuild/ui are bundled into the layer (${found.root} and ${root}). ` +
        `The platform serves one Studio per layer; make the project depend on one version.`,
    );
  }
  found.root = root;
  return STUB_ID;
}

/** The replacement's source, for its id; null for any other module. */
export function loadReplacement(id: string): string | null {
  return id === STUB_ID ? STUB_SOURCE : null;
}

/**
 * What the replaced module exports: the same function, answering every
 * request with what happened and where to look, rather than with a file.
 *
 * Reached only when the platform did NOT answer a Studio file first, which
 * means the layer's assets were not stored or not served -- a platform bug,
 * and one a person should be able to name from the response.
 */
const STUB_SOURCE = `export function createUIRequestHandler() {
  return async (path) => ({
    status: 404,
    json: {
      message: "The Studio's files are served by the platform, and it did not serve this one.",
      details: "The site was built without the Studio's files (they are build assets), so " + JSON.stringify(path) + " reached the site's server. The platform did not find it among the layer's assets.",
    },
  });
}
`;

/** The `node_modules/<name>` directory holding `file`, named `@valbuild/ui`. */
function packageRootOf(file: string): string | null {
  let dir = dirname(file);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const { name } = JSON.parse(readFileSync(manifest, "utf8")) as {
          name?: unknown;
        };
        if (name === "@valbuild/ui") return dir;
      } catch {
        // Not a package manifest we can read: keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The Studio as build assets: every route of `@valbuild/ui`'s manifest under
 * {@link STUDIO_STATIC_ROUTE}, and the bytes of every file a route names,
 * base64, by sha256.
 *
 * Each file's hash is checked against the manifest as it is read: what the
 * platform stores under a hash is what anything asking for that hash gets,
 * forever, so a file that does not match is a broken package, not a file.
 */
export async function studioAssetsOf(root: string): Promise<{
  assets: BuildAssets;
  files: Record<string, string>;
  version: string;
}> {
  const manifest = JSON.parse(
    await readFile(join(root, "static", "manifest.json"), "utf8"),
  ) as StudioManifest;
  if (manifest.format !== MANIFEST_FORMAT) {
    throw new Error(
      `@valbuild/ui@${manifest.version} describes its files in format ${manifest.format}, ` +
        `and this build reads format ${MANIFEST_FORMAT}. Update @valbuild/tanstack-build.`,
    );
  }
  const files: Record<string, string> = {};
  const assetOf = (file: string, cacheControl: string): BuildAsset => {
    const described = manifest.files[file];
    if (!described) {
      throw new Error(
        `@valbuild/ui@${manifest.version}'s manifest names ${file}, which it does not list.`,
      );
    }
    return {
      sha256: described.sha256,
      contentType: described.contentType,
      cacheControl,
    };
  };
  const read = async (file: string, sha256: string) => {
    if (sha256 in files) return;
    const bytes = await readFile(join(root, "static", "files", file));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha256) {
      throw new Error(
        `@valbuild/ui@${manifest.version}'s static${file} does not match its manifest ` +
          `(sha256 ${actual}, expected ${sha256}). The package is corrupt; reinstall it.`,
      );
    }
    files[sha256] = bytes.toString("base64");
  };

  const paths: Record<string, BuildAsset> = {};
  for (const [route, { file, cacheControl }] of Object.entries(
    manifest.routes,
  )) {
    const asset = assetOf(file, cacheControl);
    paths[`${STUDIO_STATIC_ROUTE}${route}`] = asset;
    await read(file, asset.sha256);
  }
  const fallback = assetOf(
    manifest.fallback.file,
    manifest.fallback.cacheControl,
  );
  await read(manifest.fallback.file, fallback.sha256);
  return {
    assets: {
      paths,
      fallbacks: [{ prefix: `${STUDIO_STATIC_ROUTE}/`, ...fallback }],
    },
    files,
    version: manifest.version,
  };
}

/**
 * A digest of an asset map, for the layer revision.
 *
 * The replaced module is the same text whichever Studio it replaced, so the
 * layer's code alone does not change when only `@valbuild/ui` does -- and a
 * layer that keeps its revision is never sent again, so the new Studio's
 * files would never reach the platform. The map changes, so the map is
 * folded in.
 */
export function assetsRev(assets: BuildAssets): string {
  const digest = createHash("sha256");
  for (const [path, asset] of Object.entries(assets.paths).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    digest.update(
      `${path}\0${asset.sha256}\0${asset.contentType}\0${asset.cacheControl}\n`,
    );
  }
  for (const fallback of assets.fallbacks) {
    digest.update(
      `fallback\0${fallback.prefix}\0${fallback.sha256}\0${fallback.contentType}\0${fallback.cacheControl}\n`,
    );
  }
  return digest.digest("hex").slice(0, 8);
}
