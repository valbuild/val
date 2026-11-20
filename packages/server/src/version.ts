/**
 * This package's version, inlined at build time.
 *
 * The same static JSON import `@valbuild/next` and `@valbuild/tanstack` use,
 * for the reason theirs gives: `require` does not exist in an ESM bundle, and
 * preconstruct inlines the import. Read by the Studio's version list
 * (`/versions`), which is the only place it is shown.
 */
/*
 * A default import, not `import { version }`: preconstruct builds with
 * `@rollup/plugin-json` configured `namedExports: false`.
 */
import packageJson from "../package.json";

export const VERSION: string = packageJson.version;
