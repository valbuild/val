import { Internal } from "@valbuild/core";
import type { SourceStore } from "../../stores/SourceStore";
import type { SerializedPatchSet } from "../../utils/PatchSets";
import type { FieldChange } from "./changeDescription";

/** A peek answer we cannot describe: still loading, or failed. */
const UNKNOWN = Symbol("unknown");

/**
 * A peek answer as a value the prompt can carry.
 *
 * `ready` is its data and `absent` is `undefined` — which is what
 * `describeValue` renders as "(not set)", and the before-value of a field this
 * publish adds. Everything else is genuinely unknown.
 */
function readPeek(
  peek:
    | { status: string; data?: unknown }
    | { status: "absent" }
    | { status: string },
): unknown {
  if (peek.status === "ready") {
    return (peek as { data: unknown }).data;
  }
  if (peek.status === "absent") {
    return undefined;
  }
  return UNKNOWN;
}

/**
 * What each patch set changed, as the before/after values the commit summary
 * prompt is written from.
 *
 * Shared by the two ways a publish gets its message — the automatic one, which
 * never shows a box, and the required one, which does — so both describe the
 * same publish in the same words.
 */
export function collectFieldChanges(
  patchSets: SerializedPatchSet,
  store: SourceStore,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const patchSet of patchSets) {
    const sourcePath = Internal.joinModuleFilePathAndModulePath(
      patchSet.moduleFilePath,
      Internal.patchPathToModulePath(patchSet.patchPath),
    );
    const after = readPeek(store.peek(sourcePath));
    const before = readPeek(store.peekBase(sourcePath));
    // A value still loading is unknown, not unchanged, and saying "unchanged"
    // would hide a real change. `absent` is not that: it is a definite answer,
    // and the answer an added or deleted field has on one side.
    if (after === UNKNOWN || before === UNKNOWN) {
      continue;
    }
    changes.push({
      sourcePath,
      moduleFilePath: patchSet.moduleFilePath,
      fieldPath: patchSet.patchPath.join("."),
      schemaType: patchSet.schemaTypes[0],
      before,
      after,
    });
  }
  return changes;
}
