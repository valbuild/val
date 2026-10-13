/**
 * This package's version, inlined at build time: part of every build's id
 * (`buildInputId`), since a different builder can emit different bytes from
 * the same inputs.
 *
 * A default JSON import, as `@valbuild/tanstack`'s `version.ts` explains:
 * preconstruct inlines it, and every bundler and jest resolve it in dev.
 */
import packageJson from "../package.json";

export const VERSION: string = packageJson.version;
