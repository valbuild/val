/**
 * The React layer over the store system.
 *
 * The directly tested read/write hooks over the stores. `hooks.test.tsx` drives
 * these; `components/ValFieldProvider.tsx` is the app-facing surface and is built
 * the same way. See `SystemContext.tsx` for the history and for why every read
 * hook peeks synchronously and demands from an effect.
 */
export {
  ValSystemProvider,
  useValSystem,
  type ValSystem,
} from "./SystemContext";
export { useSourceAtPath, type SourceAtPath } from "./useSourceAtPath";
export { useModuleSchema, type SchemaAtPath } from "./useSchemaAtPath";
export {
  useModuleValidation,
  useValidationErrorsAtPath,
} from "./useValidationErrors";
export { useRenderAtPath } from "./useRenderAtPath";
export { useAddPatch, useSyncStatus, useValField } from "./useAddPatch";
