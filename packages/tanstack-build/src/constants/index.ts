/**
 * The contract's constants, and nothing else: `@valbuild/tanstack-build/constants`.
 *
 * The same values the root exports, from an entrypoint that imports nothing
 * else. It exists for callers that must not take the builder with them, because
 * the root pulls in `@rolldown/browser`, whose loader fetches 10.9 MB of wasm at
 * module evaluation:
 *
 * - the platform's browser route generator, which bundles its own code -- from
 *   the root it went from 4.1 MB to 5.4 MB, and would have fetched the bundler
 *   to write a route tree;
 * - content's `loaderPayload.ts`, a Node server that takes a publish's
 *   artifacts apart by these keys.
 *
 * An entrypoint rather than literals in those places because these ARE the
 * contract with the builder, and a copy is what drifts.
 */
export { ENTRY, ENTRY_SHIM, ROUTES_DIR, TREE } from "../projectPaths";
export { ARTIFACT_KEYS, ARTIFACT_PREFIXES } from "../artifactKeys";
