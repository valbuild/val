/**
 * This package's version, inlined at build time.
 *
 * A static JSON import rather than `require("../package.json")`: `require`
 * does not exist in an ESM bundle, so anything that bundles this for ESM got
 * `null` here silently — and a null version is what proxy mode refuses to
 * start on. preconstruct inlines it (it ships `@rollup/plugin-json`), and
 * every bundler and jest resolve it in dev.
 */
/*
 * A default import, not `import { version }`.
 *
 * preconstruct builds with `@rollup/plugin-json` configured `namedExports:
 * false`, so a JSON module has only a default export and a named import fails
 * the BUILD (not the typecheck) with "'version' is not exported by
 * package.json".
 */
import packageJson from "../package.json";

export const VERSION: string | null = packageJson.version ?? null;
