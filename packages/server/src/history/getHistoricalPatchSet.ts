import { result } from "@valbuild/core/fp";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type {
  HistoricalModule,
  HistoricalPatchSet,
  StoredModuleVersion,
} from "./types";
import { fetchCommitRecord } from "./fetchCommitRecord";
import { resolveJsonEntriesAtCommit } from "./resolveJsonEntriesAtCommit";
import { describeBinaryFilesAtCommit } from "./describeBinaryFiles";
import { changedPathsOf } from "./changedPaths";
import { SerializedSchema } from "@valbuild/shared/internal";
import { fromError as fromZodError } from "zod-validation-error";

/**
 * Reconstruct one commit: how each module looked before it, and after it.
 *
 * Deliberately says NOTHING about the current source or the current schema. For
 * a given commit sha this can never change, which is what lets its result be
 * cached forever and what makes flipping between commits cheap. The comparison
 * against today is `compareWithCurrent`, and it is deliberately the cheap half.
 *
 * Nothing is parsed and nothing is replayed: the module's data was recorded at
 * the commit, so reading it back is a read. What IS done here is validating the
 * stored schema against this version of Val, because that is the one thing the
 * content service could not check for us.
 *
 * Failures are collected per module, not thrown - one module this Val cannot
 * read leaves the other nine readable, and knowing WHICH one is the thing
 * someone opening history actually needs. Only a commit that cannot be read at
 * all is an `err`.
 */
export async function getHistoricalPatchSet(
  ops: ValOps,
  commitSha: string,
  options?: { apiBasePath?: string },
): Promise<result.Result<HistoricalPatchSet, HistoryError>> {
  const recordRes = await fetchCommitRecord(ops, commitSha);
  if (result.isErr(recordRes)) {
    return recordRes;
  }
  const { commit, patches, modules: stored, affectedFiles } = recordRes.value;
  const warnings: HistoryError[] = [];

  // Group the commit's patches by module. Not to replay them - the stored
  // source already IS the result - but because the ops name the paths this
  // commit touched, which is what the view highlights.
  const patchesByModule = new Map<
    ModuleFilePath,
    { patchId: PatchId; coreVersion: string; patch: Patch }[]
  >();
  for (const patch of patches) {
    const existing = patchesByModule.get(patch.moduleFilePath) ?? [];
    existing.push({
      patchId: patch.patchId,
      coreVersion: patch.coreVersion,
      // The wire type is `unknown` because the content service does not know
      // Val's patch type; it has been validated on the way out of the archive.
      patch: patch.patch as Patch,
    });
    patchesByModule.set(patch.moduleFilePath, existing);
  }

  const storedByPath = new Map<ModuleFilePath, StoredModuleVersion>(
    stored.map((module) => [module.moduleFilePath, module]),
  );

  // Every module this commit touched: one it patched, and one we hold a stored
  // version of. Usually the same set - but a commit made by a Val too old to
  // send its modules has the first and not the second, and that has to read as
  // `source-unavailable` rather than as "no modules changed".
  const touched = new Set<ModuleFilePath>([
    ...patchesByModule.keys(),
    ...storedByPath.keys(),
  ]);

  const modules: Record<ModuleFilePath, HistoricalModule> = {};
  for (const moduleFilePath of touched) {
    const failures: HistoryError[] = [];
    const modulePatches = patchesByModule.get(moduleFilePath) ?? [];
    const patchIds = modulePatches.map((patch) => patch.patchId);
    const changedPaths = changedPathsOf(moduleFilePath, modulePatches);
    const version = storedByPath.get(moduleFilePath);

    if (version === undefined || version.unavailable) {
      failures.push({ kind: "source-unavailable", moduleFilePath });
      modules[moduleFilePath] = {
        source: null,
        schema: null,
        patchIds,
        changedPaths,
        failures,
      };
      continue;
    }

    /*
     * The schema is validated here, and nowhere earlier.
     *
     * It was stored as written and served back opaquely, so this is the first
     * place that knows what a schema is supposed to look like. A failure is
     * NOT damage and not anyone's mistake - Val's schema format is allowed to
     * move, and an older project opened in a newer Val (or the reverse) lands
     * exactly here. The module reads as one this version cannot show, and the
     * rest of the commit is unaffected.
     */
    const schemaRes = SerializedSchema.safeParse(version.schema);
    if (!schemaRes.success) {
      failures.push({
        kind: "schema-unreadable",
        moduleFilePath,
        message: fromZodError(schemaRes.error).toString(),
      });
      modules[moduleFilePath] = {
        source: version.source,
        schema: null,
        patchIds,
        changedPaths,
        failures,
      };
      continue;
    }

    modules[moduleFilePath] = {
      source: version.source,
      schema: schemaRes.data,
      patchIds,
      changedPaths,
      failures,
    };
  }

  const entriesRes = await resolveJsonEntriesAtCommit(
    ops,
    commitSha,
    affectedFiles,
  );
  let jsonEntries: HistoricalPatchSet["jsonEntries"] = {};
  if (result.isErr(entriesRes)) {
    // Entry contents are supporting detail, not the commit. Losing them should
    // narrow what can be shown, not hide the commit entirely.
    warnings.push(entriesRes.error);
  } else {
    jsonEntries = entriesRes.value.entries;
    warnings.push(...entriesRes.value.failures);
  }

  return result.ok({
    commit,
    modules,
    patches,
    jsonEntries,
    binaryFiles: describeBinaryFilesAtCommit(
      commitSha,
      affectedFiles,
      options?.apiBasePath ?? "/api/val",
    ),
    warnings,
  });
}
