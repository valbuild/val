import { SerializedSchema, Json } from "@valbuild/core";
import { PatchSetMetadata, SerializedPatchSet } from "./PatchSets";
import { resolvePatchPath } from "../resolvePatchPath";

export type PatchSetComparison = {
  patchSet: PatchSetMetadata;
  before: Json;
  after: Json;
  beforeSchema: SerializedSchema | undefined;
  afterSchema: SerializedSchema | undefined;
};

export function comparePatchSets(
  schema: SerializedSchema,
  patchSets: SerializedPatchSet,
  beforeSource: Json,
  afterSource: Json,
): PatchSetComparison[] {
  return patchSets.map((patchSet) => {
    const { patchPath } = patchSet;

    // Handle empty patch path (root level changes)
    if (patchPath.length === 0) {
      return {
        patchSet,
        before: beforeSource,
        after: afterSource,
        beforeSchema: schema,
        afterSchema: schema,
      };
    }

    // Resolve before value and schema
    const beforeResolution = resolvePatchPath(patchPath, schema, beforeSource);
    const beforeValue = beforeResolution.success
      ? beforeResolution.source
      : null;
    const beforeSchema = beforeResolution.success
      ? beforeResolution.schema
      : undefined;

    // Resolve after value and schema
    const afterResolution = resolvePatchPath(patchPath, schema, afterSource);
    const afterValue = afterResolution.success ? afterResolution.source : null;
    const afterSchema = afterResolution.success
      ? afterResolution.schema
      : undefined;

    return {
      patchSet,
      before: beforeValue,
      after: afterValue,
      beforeSchema,
      afterSchema,
    };
  });
}
