import { result } from "@valbuild/core/fp";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type Patch,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import type { HistoryError } from "./HistoryError";
import { checkCoreVersion } from "./coreVersions";

const jsonOps = new JSONOps();

export type ReplayInput = {
  patchId: PatchId;
  coreVersion: string;
  patch: Patch;
};

export type ReplayResult = {
  source: JSONValue;
  applied: PatchId[];
  failures: HistoryError[];
};

/**
 * Replay a commit's patches onto the source they were recorded against.
 *
 * PER PATCH, deliberately. One op that no longer applies degrades to a reported
 * `patch-not-applicable` and the remaining patches still replay; the
 * alternative - failing the module - would hide the nine changes that were fine
 * behind the one that was not, and it is the nine that tell you what this
 * commit did.
 *
 * A patch that fails leaves the source as it was before that patch, so `applied`
 * is exactly what `source` reflects. That does mean a later patch may then fail
 * too, because it was written against a source this one did not produce - which
 * is honest: the reported failures are the real dependency chain.
 *
 * `file` ops are skipped. They carry binary payloads, not source edits - the
 * bytes live in git at this commit, reachable through the file endpoint.
 */
export function applyPatchesToSource(
  moduleFilePath: ModuleFilePath,
  before: JSONValue,
  patches: ReplayInput[],
): ReplayResult {
  let source = before;
  const applied: PatchId[] = [];
  const failures: HistoryError[] = [];

  for (const { patchId, coreVersion, patch } of patches) {
    const versionProblem = checkCoreVersion(patchId, coreVersion);
    if (versionProblem !== null) {
      // Do not replay ops from a version known to produce the wrong source: a
      // wrong answer that looks right is worse than a refusal.
      failures.push(versionProblem);
      continue;
    }
    const sourceOps = patch.filter((op) => op.op !== "file");
    if (sourceOps.length === 0) {
      applied.push(patchId);
      continue;
    }
    // applyPatch mutates what it is given, so each attempt works on its own
    // copy - otherwise a patch that fails halfway would leave the source
    // partially edited and every later patch would replay against garbage.
    const attempt = applyPatch(
      deepClone(source as ReadonlyJSONValue) as JSONValue,
      jsonOps,
      sourceOps,
    );
    if (result.isErr(attempt)) {
      failures.push({
        kind: "patch-not-applicable",
        patchId,
        moduleFilePath,
        message: attempt.error.message,
      });
      continue;
    }
    source = attempt.value;
    applied.push(patchId);
  }

  return { source, applied, failures };
}
