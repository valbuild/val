/**
 * Stands in for `packages/ui/spa/validation/schemaValidationBridge.ts`, which
 * starts a real `Worker` with `new URL(…, import.meta.url)`: a Vite construct
 * jest cannot load at all.
 *
 * The world never uses it -- every Studio is given in-process validation
 * through `createValSystem`'s `schemaValidation` option, the seam that option
 * exists for -- so this only has to let the module load. It throws if anything
 * calls it, so it can never quietly stand in for the real thing.
 */
export function createSchemaValidationBridge(): never {
  throw new Error(
    "The scenario world validates in-process; the worker bridge must not be reached.",
  );
}
