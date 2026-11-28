/**
 * `@valbuild/server/internal`: what `@valbuild/next`, `@valbuild/tanstack`,
 * `@valbuild/mcp` and the scenarios share of the server, and nothing an app
 * should import. Not public API: it changes without a major version.
 *
 * The runtime every server and reader in a process shares
 * (`createValRuntime`), its head (`ValHead`), and the draft the server-side
 * readers read from it (`draftForRequest` and friends).
 *
 * THIS ENTRY IS ON EVERY PAGE'S PATH. The server-side readers
 * (`initValContent`, `initValRsc`) import it, and they run for every visitor,
 * so everything it imports statically is evaluated by a cold isolate before
 * it can answer anyone. What a visitor's page never needs -- the data layer
 * (`ValOps*`), TypeScript, sucrase, prettier, the Studio's assets
 * (`@valbuild/ui/server`) -- is reached from here only through a dynamic
 * `import()` at the point of first use: a draft read, a save, the Val API.
 * `servingPath.test.ts` in `@valbuild/tanstack` fails when it is not.
 */
import type { ValConfig, ValModules } from "@valbuild/core";
import type { ValApiOptions } from "../ValRouter";
import type { ValRuntime } from "../valRuntime";

/**
 * The runtime the draft readers read through: see `createValRuntime` in
 * `../createValRuntime`. Loaded when it is first asked for -- by a draft read,
 * since a visitor's read never asks -- because building it evaluates the data
 * layer and everything that imports.
 */
export async function createValRuntime(
  valModules: ValModules,
  route: string,
  opts: ValApiOptions,
  config: ValConfig,
): Promise<ValRuntime> {
  const { createValRuntime } = await import("../createValRuntime");
  return createValRuntime(valModules, route, opts, config);
}
export {
  draftForRequest,
  readDraftChanges,
  serverDraftSource,
} from "../draftReads";
export type { DraftModuleRead, ReaderRuntime } from "../draftReads";
export {
  layeredSnapshot,
  proposalAsBuilt,
  readerSnapshot,
  servingBuildOf,
  stagedAfterBuild,
  type ServingBuild,
} from "../proposal";
export type { ValRuntime } from "../valRuntime";
export type { ValApiOptions };
export { serverCanStartLazily } from "../serverMode";
// For a host that shares one store between `initValServer` and the readers,
// and the formatter an app passes the former: both are constructed at module
// scope in an app's `val.server.ts`, which every page imports. Also exported
// from the package root, which is not light.
export {
  InMemoryPatchStore,
  type StoredFile,
  type StoredPatch,
  type ValPatchStore,
} from "../ValPatchStore";
export {
  createPrettierFormatter,
  type PrettierLike,
  type PrettierLoader,
  type ValFormatter,
} from "../createPrettierFormatter";
export {
  ValHead,
  headWork,
  HEAD_BUDGET_BYTES,
  HEAD_VERSIONS_PER_MODULE,
  type Draft,
  type HeadChain,
  type HeadEntries,
  type HeadModule,
  type HeadTree,
  type ModuleAnswer,
} from "../head";
export type { FoldResult, FoldRefusal } from "../proposalMerge/foldContent";
export type { Files as ProjectFiles } from "../proposalMerge/project";

/**
 * Content written back into a project's files, for connecting a project Val
 * Build hosts to a repository (valbuild/home,
 * docs/plans/connect-with-history.md, phase 6a). See
 * `proposalMerge/foldContent.ts`.
 *
 * Loaded when it is called, never with this entry: it brings the TypeScript
 * compiler, and this entry is also what a site's page reads content through,
 * which must evaluate none of it (`servingPath.test.ts` in
 * `@valbuild/tanstack`).
 */
export async function foldContent(
  ...args: Parameters<typeof import("../proposalMerge/foldContent").foldContent>
): ReturnType<typeof import("../proposalMerge/foldContent").foldContent> {
  const { foldContent } = await import("../proposalMerge/foldContent");
  return foldContent(...args);
}
