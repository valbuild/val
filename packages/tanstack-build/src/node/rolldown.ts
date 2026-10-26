import { build } from "rolldown";
import { parseAstAsync } from "rolldown/parseAst";
import type { Rolldown } from "../rolldown";

/**
 * Native rolldown, for `useRolldown` in Node: the build without the
 * WebAssembly glue a site's lockfile can break (see `../rolldown.ts`).
 */
export const nativeRolldown: Rolldown = { build, parseAstAsync };
