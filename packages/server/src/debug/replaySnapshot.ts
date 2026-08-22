import fs from "fs";
import path from "path";
import { ModuleFilePath, PatchId, DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { ValOpsFS } from "../ValOpsFS";
import { loadValModules } from "../loadValModules";
import {
  formatPatchSourceError,
  OrderedPatches,
  PatchAnalysis,
} from "../ValOps";

/**
 * Replays a `val debug` snapshot: applies its patches the way /save does and
 * validates the result.
 *
 * A snapshot is a minimal Val project (the modules the patches touch plus the
 * ones they reference, a generated val.modules.ts, and the patch chain under
 * .val/patches), so replaying it is just a ValOpsFS pointed at the directory -
 * no snapshot-specific code paths, which is the point: if the replay reproduces
 * the bug, the bug is in the ordinary code.
 */
export type ReplayResult = {
  patches: {
    patchId: PatchId;
    moduleFilePath: ModuleFilePath;
    createdAt: string;
    authorId: string | null;
    /** The error, if this patch could not be applied. */
    error?: string;
  }[];
  unappliablePatches: Record<
    PatchId,
    { moduleFilePath: ModuleFilePath; message: string }
  >;
  sourceFilePatchErrors: Record<ModuleFilePath, string[]>;
  binaryFilePatchErrors: Record<string, { message: string }>;
  validationErrors: Record<string, unknown>;
  /** What the source files look like with the appliable patches applied. */
  patchedSourceFiles: Record<string, string>;
  hasErrors: boolean;
};

export type ReplayComparison = {
  /** Patch ids that failed at capture time and still fail. */
  stillFailing: string[];
  /** Patch ids that failed at capture time but apply now (a fix, or a drift). */
  nowApplying: string[];
  /** Patch ids that apply at capture time but fail now (a regression). */
  newlyFailing: string[];
  reproduced: boolean;
};

export async function replaySnapshot(
  snapshotDir: string,
): Promise<ReplayResult> {
  const root = path.resolve(snapshotDir);
  if (!fs.existsSync(path.join(root, "val.modules.ts"))) {
    throw new Error(
      `Not a Val debug snapshot: no val.modules.ts in ${root}. ` +
        `Unzip the snapshot first.`,
    );
  }
  const valModules = loadValModules(root);
  const serverOps = new ValOpsFS(
    process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST,
    root,
    valModules,
    // The snapshot's own val.config, as evaluated by loadValModules - no need to
    // re-read it, and this way the replay uses exactly the config the snapshot
    // carries (files.directory in particular).
    { config: valModules.config },
  );
  const patchesRes = await serverOps.fetchPatches({
    patchIds: undefined,
    excludePatchOps: false,
  });
  if (patchesRes.error) {
    throw new Error(
      `Could not read the snapshot's patches: ${patchesRes.error.message}`,
    );
  }
  if (patchesRes.errors && patchesRes.errors.length > 0) {
    for (const err of patchesRes.errors) {
      console.error(`Snapshot patch could not be read: ${err.message}`);
    }
  }
  const analysis: PatchAnalysis & OrderedPatches = {
    ...serverOps.analyzePatches(patchesRes.patches),
    ...patchesRes,
  };
  const prepared = await serverOps.prepare(analysis, {
    continueOnError: true,
  });
  const sources = await serverOps.getSourcesWithPatchesApplied(analysis);
  const schemas = await serverOps.getSchemas();
  const validation = await serverOps.validateSources(
    schemas,
    sources.sources,
    analysis.patchesByModule,
  );

  const patchedSourceFiles: Record<string, string> = {};
  for (const [moduleFilePath, contents] of Object.entries(
    prepared.patchedSourceFiles,
  )) {
    if (contents !== null) {
      patchedSourceFiles[moduleFilePath] = contents;
    }
  }
  Object.assign(patchedSourceFiles, prepared.partiallyPatchedSourceFiles);

  return {
    patches: patchesRes.patches.map((patch) => ({
      patchId: patch.patchId,
      moduleFilePath: patch.path,
      createdAt: patch.createdAt,
      authorId: patch.authorId,
      error: prepared.unappliablePatches[patch.patchId]?.message,
    })),
    unappliablePatches: prepared.unappliablePatches,
    sourceFilePatchErrors: Object.fromEntries(
      Object.entries(prepared.sourceFilePatchErrors).map(([key, errors]) => [
        key,
        errors.map(formatPatchSourceError),
      ]),
    ),
    binaryFilePatchErrors: prepared.binaryFilePatchErrors,
    validationErrors: validation.errors,
    patchedSourceFiles,
    hasErrors: prepared.hasErrors,
  };
}

/**
 * Compares a replay against the report captured when the snapshot was taken, so
 * "reproduced the customer's bug" is distinguishable from "behaves differently
 * on this version".
 */
export function compareWithCapturedReport(
  result: ReplayResult,
  capturedReport: { unappliablePatches?: Record<string, unknown> },
): ReplayComparison {
  const capturedIds = Object.keys(capturedReport.unappliablePatches ?? {});
  const nowIds = Object.keys(result.unappliablePatches);
  const stillFailing = capturedIds.filter((patchId) =>
    nowIds.includes(patchId),
  );
  const nowApplying = capturedIds.filter(
    (patchId) => !nowIds.includes(patchId),
  );
  const newlyFailing = nowIds.filter(
    (patchId) => !capturedIds.includes(patchId),
  );
  return {
    stillFailing,
    nowApplying,
    newlyFailing,
    reproduced:
      capturedIds.length > 0 &&
      nowApplying.length === 0 &&
      newlyFailing.length === 0,
  };
}

export function readCapturedReport(
  snapshotDir: string,
): { unappliablePatches?: Record<string, unknown> } | null {
  const reportPath = path.join(path.resolve(snapshotDir), "report.json");
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
}
