/**
 * `@valbuild/server/internal`: what `@valbuild/next`, `@valbuild/tanstack`,
 * `@valbuild/mcp` and the scenarios share of the server, and nothing an app
 * should import. Not public API: it changes without a major version.
 *
 * The runtime every server and reader in a process shares (`valRuntime`,
 * `createValRuntime`), its head (`ValHead`), and the draft the server-side
 * readers read from it (`draftForRequest` and friends).
 */
export { createValRuntime } from "../ValRouter";
export {
  draftForRequest,
  readDraftChanges,
  readerSchemaVersion,
  serverDraftSource,
} from "../draftReads";
export type { DraftModuleRead } from "../draftReads";
export {
  proposalAsBuilt,
  servingBuildOf,
  stagedAfterBuild,
  type ServingBuild,
} from "../proposal";
export { valRuntime, type ValRuntime } from "../valRuntime";
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
