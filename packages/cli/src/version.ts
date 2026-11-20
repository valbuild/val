/**
 * This package's version, inlined at build time.
 *
 * The same static JSON import `@valbuild/server` uses (see its
 * `src/version.ts`): `require` does not exist in an ESM bundle, and
 * preconstruct inlines the import. A default import because preconstruct's
 * `@rollup/plugin-json` is configured `namedExports: false`.
 */
import packageJson from "../package.json";

export const VERSION: string = packageJson.version;
