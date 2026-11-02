/*
 * One way to load (`docs/plans/one-content-model.md`, phase 3): the sources,
 * `layered`, `planOf` and `resolveVal`, and how a server read and a component
 * wait. Every reader of `@valbuild/next` and `@valbuild/tanstack` is built on
 * these; only where the content comes from (the env) differs.
 */
export {
  ValExternalStore,
  applyValEvent,
  type HeldRead,
  type ValEventOutcome,
} from "./overlayStore";
export { createDraftStore, draftHolds, isDraft, type ValDraft } from "./draft";
export { startRefreshLoop, type RefreshLoop } from "./refreshLoop";
export {
  bundleSource,
  entryOfModuleSource,
  overlaySource,
  snapshotSource,
  type OverlayState,
} from "./sources";
export {
  layered,
  type LocatedRead,
  type SchemaRule,
  type View,
} from "./layered";
export {
  mapResolution,
  planOf,
  readWork,
  resolveModuleEntry,
  resolveVal,
  resolveValEntry,
  type ReadEnv,
  type ReadOf,
  type ReadPlan,
  type Resolution,
  type ResolveOptions,
} from "./resolveVal";
export {
  awaitResolved,
  fetchValFrom,
  readsOfFetchVal,
  useResolved,
  useResolvedEntry,
  useResolvedVal,
  type FetchValWithReads,
  type Ready,
} from "./readers";
export {
  bundledJsonEntryImport,
  getJsonEntryStegaRoot,
  isJsonValuesRecordSchema,
} from "./jsonValues";
