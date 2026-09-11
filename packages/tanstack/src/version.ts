/**
 * This package's version, inlined at build time.
 *
 * A static JSON import rather than `require("../package.json")`, which is what
 * this used to be: `require` does not exist in an ESM bundle, so under Vite —
 * which is how a TanStack Start app is built — it threw, the `catch` returned
 * `null`, and the server refused to start with "Could not get
 * @valbuild/tanstack package version". preconstruct inlines this at build time
 * (it ships `@rollup/plugin-json`), and every bundler and jest resolve it in
 * dev, so the value is a literal by the time anyone reads it.
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
