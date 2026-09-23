/**
 * A build, as the flat set of artifacts a publisher declares.
 *
 * ## Why this is here and not in three places
 *
 * The publish API addresses every artifact by a STRING KEY -- `server`,
 * `chunk/client/<name>`, `public/<path>` -- because a key that is just a string
 * is what lets one mechanism declare, upload and confirm all of them by hash.
 * That namespace was restated three times: content's `loaderPayload.ts` matched
 * the prefixes to take them apart, `val publish` reproduced them as a directory
 * layout to read, and whatever built the project had to lay that directory out.
 * Three copies of a mapping whose failure mode is silent -- a chunk filed under
 * the wrong target does not fail at publish, it fails at isolate startup with a
 * missing export naming neither package nor version.
 *
 * So the namespace is declared once, HERE, beside the {@link BuildOutput} it
 * describes. Val owns it because Val produces it.
 *
 * ## What is deliberately NOT here
 *
 * The loader's payload shape -- `serverCode`, `clientChunks`, `publicFiles` --
 * stays content's own, and `loaderPayload.ts` says why: it is a platform
 * internal, and a publisher that had to learn it would be coupled to the
 * platform, which is exactly what a project token publishing from somebody's CI
 * must not be. The KEYS are the public contract; the payload assembled from
 * them is not. This exports the first and says nothing about the second.
 *
 * ## Everything is text
 *
 * Including assets and public files, which {@link BuildOutput} carries base64
 * encoded. That is the existing wire contract rather than a choice made here:
 * the loader stores what it is given and `decodeBase64`s it on the way out, so
 * the artifact's bytes ARE the base64 text. Sending the raw bytes instead would
 * be smaller and would corrupt every image in the isolate.
 */

import type { BuildOutput } from "./build";
import { sha256Hex } from "./hash";

/** The single-file keys, in the order a reader most wants to see them. */
export const ARTIFACT_KEYS = {
  server: "server",
  client: "client",
  css: "css",
  rsc: "rsc",
  /**
   * The dependency layer: gzipped JSON, and NOT produced by a browser build.
   *
   * Named here because it is part of the namespace a reader is trying to
   * understand, not because {@link publishArtifacts} ever emits it -- building
   * a layer is a rolldown pass over `node_modules`, which a tab does not have.
   * A publisher without one sends `layerRev` instead; see `DeclareBody`.
   */
  layer: "layer",
} as const;

/** The prefixes, and which {@link BuildOutput} record fills each. */
export const ARTIFACT_PREFIXES = {
  serverChunks: "chunk/server/",
  clientChunks: "chunk/client/",
  rscChunks: "chunk/rsc/",
  assetFiles: "asset/",
  publicFiles: "public/",
} as const;

/** One artifact, ready to declare and to upload. */
export type PublishArtifact = {
  key: string;
  /** The exact bytes, as text. See the note on encoding above. */
  body: string;
  sha256: string;
  /**
   * The byte length, which is NOT `body.length`.
   *
   * Content compares this against what object storage received. A string's
   * length counts UTF-16 code units, so any non-ASCII character -- one accented
   * word in a page's markup is enough -- makes it disagree with the number of
   * bytes actually sent, and the publish is refused for a size mismatch that
   * names no file.
   */
  bytes: number;
};

/**
 * Every artifact a build publishes, by key.
 *
 * Async because the hashes are, and the hashes are because `crypto.subtle` is
 * the one digest available both in a tab and in Node -- see `hash.ts`.
 *
 * An empty stylesheet is omitted rather than uploaded as an empty artifact: a
 * project with no CSS has no `css` key, which is what `loaderPayload.ts` reads
 * `text("css") !== undefined` to decide.
 */
export async function publishArtifacts(
  build: BuildOutput,
): Promise<PublishArtifact[]> {
  const encoder = new TextEncoder();
  const out: Array<{ key: string; body: string }> = [];

  const single = (key: string, body: string | undefined) => {
    if (body === undefined || body === "") return;
    out.push({ key, body });
  };
  single(ARTIFACT_KEYS.server, build.serverCode);
  single(ARTIFACT_KEYS.client, build.clientCode);
  single(ARTIFACT_KEYS.css, build.cssCode);
  single(ARTIFACT_KEYS.rsc, build.rscCode);

  const group = (
    prefix: string,
    record: Record<string, string> | undefined,
  ) => {
    for (const [name, body] of Object.entries(record ?? {})) {
      /*
       * The name is appended and nothing else touches it. An asset is addressed
       * by the path the built code imports it at, so normalising it here --
       * stripping, lowercasing, re-joining -- produces a bundle whose imports
       * resolve to nothing, at runtime, in the isolate. `loaderPayload.ts` says
       * the same thing on the way back.
       */
      out.push({ key: `${prefix}${name}`, body });
    }
  };
  group(ARTIFACT_PREFIXES.serverChunks, build.serverChunks);
  group(ARTIFACT_PREFIXES.clientChunks, build.clientChunks);
  group(ARTIFACT_PREFIXES.rscChunks, build.rscChunks);
  group(ARTIFACT_PREFIXES.assetFiles, build.assetFiles);
  group(ARTIFACT_PREFIXES.publicFiles, build.publicFiles);

  return Promise.all(
    out.map(async ({ key, body }) => ({
      key,
      body,
      sha256: await sha256Hex(body),
      bytes: encoder.encode(body).length,
    })),
  );
}
