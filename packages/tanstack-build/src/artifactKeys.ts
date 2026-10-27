/**
 * The publish API's artifact key namespace: `server`, `chunk/client/<name>`,
 * `public/<path>` and the rest. See `artifacts.ts` for why it is declared once
 * and here.
 *
 * A module of its own, importing nothing, so it can be reached through
 * `@valbuild/tanstack-build/constants` by a caller that must not load the
 * builder -- content's `loaderPayload.ts` takes artifacts apart by these
 * prefixes in a Node server that has no use for rolldown.
 */

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
  /**
   * The project's own files, as JSON, exactly as this build was made from
   * them -- what the loader stores as the project's source.
   *
   * It has to travel WITH the build: it is what the next publisher starts
   * from, and a managed project's Studio edits one `.val.ts` and rebuilds, so
   * a build published without it leaves the stored source one edit behind --
   * and the edit after that is built on top of the stale copy and silently
   * undoes this one. The generated route tree is never in it; see
   * `projectSource` on `BuildInput`.
   */
  source: "source",
} as const;

/** The prefixes, and which {@link BuildOutput} record fills each. */
export const ARTIFACT_PREFIXES = {
  serverChunks: "chunk/server/",
  clientChunks: "chunk/client/",
  rscChunks: "chunk/rsc/",
  assetFiles: "asset/",
  publicFiles: "public/",
} as const;
