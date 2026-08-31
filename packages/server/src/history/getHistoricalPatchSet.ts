import { result } from "@valbuild/core/fp";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type { HistoricalModule, HistoricalPatchSet } from "./types";
import { fetchCommitRecord } from "./fetchCommitRecord";
import { parseModuleSource } from "./parseModuleSource";
import { applyPatchesToSource } from "./applyPatchesToSource";
import { resolveJsonEntriesAtCommit } from "./resolveJsonEntriesAtCommit";
import { describeBinaryFilesAtCommit } from "./describeBinaryFiles";
import { diffSources } from "./diffSources";

/**
 * Reconstruct one commit: how each module looked before it, and after it.
 *
 * Deliberately says NOTHING about the current source or the current schema. For
 * a given commit sha this can never change, which is what lets its result be
 * cached forever and what makes flipping between commits cheap. The comparison
 * against today is `compareWithCurrent`, and it is deliberately the cheap half.
 *
 * Failures are collected per module, not thrown - one unparseable module out of
 * ten leaves the other nine readable, and knowing WHICH one is broken is the
 * thing someone opening history actually needs. Only a commit that cannot be
 * read at all is an `err`.
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
  const { commit, patches, previousSourceFiles, affectedFiles } =
    recordRes.value;
  const warnings: HistoryError[] = [];

  // Group the commit's patches by the module they change, keeping seq order -
  // replaying them in any other order gives a different source.
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

  // Every module this commit touched: one that was patched, and one whose
  // stored source we have. Usually the same set - but a commit made by a client
  // too old to send its sources has the first and not the second, and that has
  // to show up as `source-unavailable` rather than as "no modules changed".
  const touched = new Set<ModuleFilePath>([
    ...patchesByModule.keys(),
    ...(Object.keys(previousSourceFiles) as ModuleFilePath[]),
  ]);

  const modules: Record<ModuleFilePath, HistoricalModule> = {};
  for (const moduleFilePath of touched) {
    const failures: HistoryError[] = [];
    const modulePatches = patchesByModule.get(moduleFilePath) ?? [];
    const patchIds = modulePatches.map((patch) => patch.patchId);
    const text = previousSourceFiles[moduleFilePath];

    if (text === undefined) {
      failures.push({ kind: "source-unavailable", moduleFilePath });
      modules[moduleFilePath] = {
        before: null,
        after: null,
        patchIds,
        changedPaths: [],
        failures,
      };
      continue;
    }

    const beforeRes = parseModuleSource(moduleFilePath, text);
    if (result.isErr(beforeRes)) {
      failures.push(beforeRes.error);
      modules[moduleFilePath] = {
        before: null,
        after: null,
        patchIds,
        changedPaths: [],
        failures,
      };
      continue;
    }

    const before = beforeRes.value;
    const replayed = applyPatchesToSource(
      moduleFilePath,
      before,
      modulePatches,
    );
    failures.push(...replayed.failures);
    modules[moduleFilePath] = {
      before,
      after: replayed.source,
      patchIds,
      changedPaths: diffSources(moduleFilePath, before, replayed.source),
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
