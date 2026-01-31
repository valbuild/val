import {
  SerializedSchema,
  Json,
  Schema,
  SelectorSource,
  SourcePath,
  ModuleFilePath,
  ReifiedRender,
} from "@valbuild/core";
import { PatchSetMetadata, SerializedPatchSet } from "./PatchSets";
import { resolvePatchPath } from "../resolvePatchPath";

export type PatchSetComparison = {
  patchSet: PatchSetMetadata;
  before: Json;
  after: Json;
  beforeSchema: SerializedSchema | undefined;
  afterSchema: SerializedSchema | undefined;
  render?: ReifiedRender;
  moveOperation?: {
    type: "source" | "destination";
    relatedPath: string[];
    pairIndex?: number; // Index of the paired move operation
  };
};

export function comparePatchSets(
  rootSchema: Schema<SelectorSource>,
  schema: SerializedSchema,
  patchSets: SerializedPatchSet,
  beforeSource: Json,
  afterSource: Json,
  _moduleFilePath: ModuleFilePath,
): PatchSetComparison[] {
  const comparisons: PatchSetComparison[] = patchSets.map((patchSet) => {
    const { patchPath } = patchSet;

    // Handle empty patch path (root level changes)
    if (patchPath.length === 0) {
      const render = rootSchema["executeRender"](
        "/" as SourcePath,
        beforeSource,
      );
      return {
        patchSet,
        before: beforeSource,
        after: afterSource,
        beforeSchema: schema,
        afterSchema: schema,
        render,
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

    // Get render information from the root schema
    const sourcePath = ("/" + patchPath.join("/")) as SourcePath;
    const render = beforeResolution.success
      ? rootSchema["executeRender"](sourcePath, beforeValue)
      : undefined;

    return {
      patchSet,
      before: beforeValue,
      after: afterValue,
      beforeSchema,
      afterSchema,
      render,
    };
  });

  // Detect and annotate move operations in records
  for (let i = 0; i < comparisons.length; i++) {
    const comparison = comparisons[i];
    const hasMove = comparison.patchSet.opTypes.includes("move");
    const isRecord = comparison.patchSet.schemaTypes.includes("record");

    if (hasMove && isRecord) {
      // Check if this is a source (removal) or destination (addition)
      if (comparison.before !== null && comparison.after === null) {
        // This is the source - look for the matching destination
        for (let j = i + 1; j < comparisons.length; j++) {
          const other = comparisons[j];
          const otherHasMove = other.patchSet.opTypes.includes("move");
          const sameParentPath =
            comparison.patchSet.patchPath.slice(0, -1).join("/") ===
            other.patchSet.patchPath.slice(0, -1).join("/");
          const samePatchId =
            comparison.patchSet.patches[0]?.patchId ===
            other.patchSet.patches[0]?.patchId;

          if (
            otherHasMove &&
            sameParentPath &&
            samePatchId &&
            other.before === null &&
            other.after !== null
          ) {
            // Found the matching destination
            comparisons[i].moveOperation = {
              type: "source",
              relatedPath: other.patchSet.patchPath,
              pairIndex: j,
            };
            comparisons[j].moveOperation = {
              type: "destination",
              relatedPath: comparison.patchSet.patchPath,
              pairIndex: i,
            };
            break;
          }
        }
      }
    }
  }

  return comparisons;
}

/**
 * Generate a human-readable change description using technical paths
 * @param comparison The patch set comparison
 * @returns A clear, unambiguous description of the change
 */
export function generateChangeDescription(
  comparison: PatchSetComparison,
): string {
  const path = `/${comparison.patchSet.patchPath.join("/")}`;
  const { opTypes } = comparison.patchSet;

  if (opTypes.includes("move") && comparison.moveOperation) {
    const fromPath = `/${comparison.moveOperation.relatedPath.join("/")}`;
    return `Moved ${fromPath} to ${path}`;
  }

  if (comparison.before === null && comparison.after !== null) {
    return `Added ${path}`;
  }

  if (comparison.before !== null && comparison.after === null) {
    return `Removed ${path}`;
  }

  return `Changed ${path}`;
}

/**
 * Get the change type for icon/styling purposes
 */
export function getChangeType(
  comparison: PatchSetComparison,
): "add" | "remove" | "move" | "edit" | "multiple" {
  const { opTypes } = comparison.patchSet;

  if (opTypes.includes("move") && comparison.moveOperation) {
    return "move";
  }

  if (comparison.before === null && comparison.after !== null) {
    return "add";
  }

  if (comparison.before !== null && comparison.after === null) {
    return "remove";
  }

  if (opTypes.length > 1) {
    return "multiple";
  }

  return "edit";
}
