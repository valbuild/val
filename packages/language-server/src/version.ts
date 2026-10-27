/**
 * This package's version, inlined at build time.
 *
 * See `packages/core/src/index.ts` for why this is a static JSON import rather
 * than `require("../package.json")`. The version is only ever displayed here,
 * but the two should not drift apart in how they read it.
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

export function getLanguageServerVersion(): string | null {
  return packageJson.version ?? null;
}
