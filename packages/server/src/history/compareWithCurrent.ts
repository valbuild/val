import { result } from "@valbuild/core/fp";
import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import type { Sources, ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type {
  HistoricalComparison,
  HistoricalPatchSet,
  ModuleComparison,
} from "./types";
import { diffSources } from "./diffSources";
import { validateAgainstCurrentSchema } from "./validateAgainstCurrentSchema";
import { buildRestoreVerdict } from "./restorability";

/**
 * Measure a reconstructed commit against the project as it is now.
 *
 * The volatile half. `getHistoricalPatchSet` is fixed for a given commit sha
 * and can be cached forever; this depends on the current source and schema,
 * which move with every edit - so it is recomputed, and it is cheap precisely
 * because the reconstruction is already done.
 *
 * Answers two questions per module:
 *
 *   what would a restore UNDO?  `after` vs `current` - not `before` vs
 *                               `current`, because what is on offer is the
 *                               state the commit produced.
 *   would a restore be VALID?   the historical value against TODAY's schema.
 */
export async function compareWithCurrent(
  ops: ValOps,
  patchSet: HistoricalPatchSet,
): Promise<result.Result<HistoricalComparison, HistoryError>> {
  let currentSources: Sources;
  try {
    const sourcesResult = await ops.getSources();
    currentSources = sourcesResult.sources;
  } catch (err) {
    return result.err({
      kind: "transport",
      message: `Could not read the project's current sources: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  // Only modules whose historical source could actually be reconstructed can be
  // checked against the schema; the rest already carry the reason why not.
  const historicalSources: Record<ModuleFilePath, JSONValue> = {};
  for (const [pathString, module] of Object.entries(patchSet.modules)) {
    if (module.after !== null) {
      historicalSources[pathString as ModuleFilePath] = module.after;
    }
  }

  const verdictRes = await validateAgainstCurrentSchema(ops, historicalSources);
  if (result.isErr(verdictRes)) {
    return verdictRes;
  }
  const schemaProblems = verdictRes.value.problems;

  const modules: Record<ModuleFilePath, ModuleComparison> = {};
  for (const [pathString, module] of Object.entries(patchSet.modules)) {
    const moduleFilePath = pathString as ModuleFilePath;
    const currentSource = currentSources[moduleFilePath];
    const current =
      currentSource === undefined ? null : (currentSource as JSONValue);
    modules[moduleFilePath] = {
      current,
      changedVsCurrent: diffSources(moduleFilePath, module.after, current),
      verdict: buildRestoreVerdict({
        moduleFilePath,
        // The whole module: a caller restoring a narrower selection asks for a
        // verdict on those paths itself, with the same failures.
        paths: [],
        failures: [
          ...module.failures,
          ...(schemaProblems[moduleFilePath] ?? []),
        ],
      }),
    };
  }

  return result.ok({ patchSet, modules });
}
