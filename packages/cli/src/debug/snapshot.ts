import fs from "fs";
import path from "path";
import { ModuleFilePath, PatchId } from "@valbuild/core";
import {
  formatPatchSourceError,
  OrderedPatches,
  PatchAnalysis,
  PreparedCommit,
} from "@valbuild/server";
import { DebugContext } from "./context";
import { InclusionReason, resolveModuleClosure } from "./moduleClosure";
import { collectImportedProjectFiles } from "./importGraph";
import { getVersions } from "../getVersions";

/** Long strings (base64 payloads) are elided so a snapshot stays attachable. */
const MAX_PATCH_STRING_LENGTH = 4096;

export type SnapshotPatch = {
  patchId: PatchId;
  path: ModuleFilePath;
  createdAt: string;
  authorId: string | null;
  baseSha: string;
  appliedAt: { commitSha: string } | null;
  /** Parent in the chain: null means it is the first ("head"). */
  parentPatchId: PatchId | null;
  patch: unknown;
};

export type SnapshotManifest = {
  generatedAt: string;
  mode: "fs" | "http";
  project: string | null;
  branch: string | null;
  /** The commit the module sources were read at. */
  commit: string | null;
  baseSha: string;
  filesDirectory: string;
  authKind: "pat" | "api-key" | "none";
  versions: {
    /** Resolved at runtime by the cli that captured this. */
    core?: string;
    next?: string;
    /**
     * The @valbuild/* versions the project declares. This is what to check out
     * in the val repo in order to replay on the code the customer was running.
     */
    project: Record<string, string>;
    node: string;
    platform: string;
  };
  modules: {
    moduleFilePath: ModuleFilePath;
    /** Why the snapshot includes it. */
    reasons: InclusionReason[];
    /** Whether the text came from the ops (authoritative) or the local disk. */
    source: "ops" | "local" | "missing";
  }[];
  patchCount: number;
  unappliablePatchCount: number;
  /**
   * The content api does not return parentRef, so the on-disk chain was rebuilt
   * from the order the api returned. A replay therefore reproduces the server's
   * ordering, which is the thing we are usually chasing.
   */
  patchChainSynthesised: boolean;
  /** Import specifiers that could not be resolved to a project file. */
  unresolvedImports: { from: string; specifier: string }[];
  elidedPatchValues: { patchId: PatchId; path: string[] }[];
  includesBinaryFiles: boolean;
};

export type SnapshotReport = {
  unappliablePatches: PreparedCommit["unappliablePatches"];
  appliedPatches: PreparedCommit["appliedPatches"];
  triedPatches: PreparedCommit["triedPatches"];
  skippedPatches: PreparedCommit["skippedPatches"];
  sourceFilePatchErrors: Record<ModuleFilePath, string[]>;
  binaryFilePatchErrors: PreparedCommit["binaryFilePatchErrors"];
  hasErrors: boolean;
  validationErrors: Record<string, unknown>;
};

export type SnapshotResult = {
  manifest: SnapshotManifest;
  report: SnapshotReport;
  /** Snapshot-relative path -> contents. Everything that goes in the zip. */
  entries: Record<string, string>;
};

export async function buildSnapshot(
  ctx: DebugContext,
  options: { includeFiles?: boolean } = {},
): Promise<SnapshotResult> {
  const { serverOps } = ctx;
  const patchesRes = await serverOps.fetchPatches({
    patchIds: undefined,
    excludePatchOps: false,
  });
  if (patchesRes.error) {
    throw new Error(`Could not fetch patches: ${patchesRes.error.message}`);
  }
  const orderedPatches = patchesRes.patches;
  const analysis: PatchAnalysis & OrderedPatches = {
    ...serverOps.analyzePatches(orderedPatches),
    ...patchesRes,
  };
  const prepared = await serverOps.prepare(analysis, {
    continueOnError: true,
  });

  const serializedSchemas = await serverOps.getSerializedSchemas();
  const patchedModules = Object.keys(analysis.patchesByModule).map(
    (moduleFilePathS) => moduleFilePathS as ModuleFilePath,
  );
  const closure = resolveModuleClosure(patchedModules, serializedSchemas);

  // Read every included module at the revision the ops point at. prepare()
  // already read the patched ones, so reuse those rather than fetching twice.
  const moduleTexts: Record<string, string> = {};
  const moduleProvenance: Record<ModuleFilePath, "ops" | "local" | "missing"> =
    {};
  for (const moduleFilePath of closure.keys()) {
    const fromPrepare = prepared.previousSourceFiles[moduleFilePath];
    if (fromPrepare !== undefined) {
      moduleTexts[moduleFilePath] = fromPrepare;
      moduleProvenance[moduleFilePath] = "ops";
      continue;
    }
    const res = await serverOps.readProjectFile(moduleFilePath);
    if (res.error) {
      const local = readLocalFile(ctx.projectRoot, moduleFilePath);
      if (local !== null) {
        moduleTexts[moduleFilePath] = local;
        moduleProvenance[moduleFilePath] = "local";
      } else {
        moduleProvenance[moduleFilePath] = "missing";
        console.warn(
          `Could not read module ${moduleFilePath}: ${res.error.message}`,
        );
      }
      continue;
    }
    moduleTexts[moduleFilePath] = res.data;
    moduleProvenance[moduleFilePath] = "ops";
  }

  // Files the modules import, at the same revision, falling back to local disk.
  const readProjectFileOrLocal = async (
    projectRelativePath: string,
  ): Promise<string | null> => {
    const res = await serverOps.readProjectFile(projectRelativePath);
    if (!res.error) {
      return res.data;
    }
    return readLocalFile(ctx.projectRoot, projectRelativePath);
  };
  const imported = await collectImportedProjectFiles(
    Object.entries(moduleTexts).map(([p, contents]) => ({ path: p, contents })),
    readProjectFileOrLocal,
  );

  const entries: Record<string, string> = {};
  for (const [projectPath, contents] of Object.entries(moduleTexts)) {
    entries[toSnapshotPath(projectPath)] = contents;
  }
  for (const [projectPath, contents] of Object.entries(imported.files)) {
    entries[toSnapshotPath(projectPath)] = contents;
  }

  // getCompilerOptions() throws without one of these at the root, so a snapshot
  // without it cannot be loaded at all.
  const tsConfig =
    readLocalFile(ctx.projectRoot, "/tsconfig.json") ??
    readLocalFile(ctx.projectRoot, "/jsconfig.json");
  if (tsConfig === null) {
    throw new Error(
      `Could not read tsconfig.json nor jsconfig.json in ${ctx.projectRoot}. ` +
        `A snapshot cannot be replayed without one.`,
    );
  }
  entries["tsconfig.json"] = tsConfig;

  const originalValModules =
    readLocalFile(ctx.projectRoot, "/val.modules.ts") ??
    readLocalFile(ctx.projectRoot, "/val.modules.js");
  if (originalValModules !== null) {
    entries["val.modules.original.ts"] = originalValModules;
  }
  entries["val.modules.ts"] = generateValModules(
    Object.keys(moduleTexts).sort(),
  );

  const patches = toSnapshotPatches(orderedPatches);
  const elidedPatchValues: { patchId: PatchId; path: string[] }[] = [];
  for (const patch of patches) {
    const elided = elideLongStrings(patch.patch);
    patch.patch = elided.value;
    for (const p of elided.elided) {
      elidedPatchValues.push({ patchId: patch.patchId, path: p });
    }
    entries[`.val/patches/${patch.parentPatchId ?? "head"}/patch.json`] =
      JSON.stringify(toFsPatch(patch), null, 2);
  }

  let includesBinaryFiles = false;
  if (options.includeFiles) {
    includesBinaryFiles = await writeBinaryFiles(
      ctx,
      analysis.fileLastUpdatedByPatchId,
      patches,
      entries,
    );
  }

  const validation = await validateSnapshotSources(ctx, analysis);

  const report: SnapshotReport = {
    unappliablePatches: prepared.unappliablePatches,
    appliedPatches: prepared.appliedPatches,
    triedPatches: prepared.triedPatches,
    skippedPatches: prepared.skippedPatches,
    sourceFilePatchErrors: Object.fromEntries(
      Object.entries(prepared.sourceFilePatchErrors).map(([key, errors]) => [
        key,
        errors.map(formatPatchSourceError),
      ]),
    ),
    binaryFilePatchErrors: prepared.binaryFilePatchErrors,
    hasErrors: prepared.hasErrors,
    validationErrors: validation,
  };

  const manifest: SnapshotManifest = {
    generatedAt: new Date().toISOString(),
    mode: ctx.mode,
    project: ctx.project,
    branch: ctx.branch,
    commit: ctx.commit,
    baseSha: await serverOps.getBaseSha(),
    filesDirectory: ctx.filesDirectory,
    authKind: ctx.authKind,
    versions: {
      core: getVersions().coreVersion,
      next: getVersions().nextVersion,
      project: readProjectValVersions(ctx.projectRoot),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    modules: Array.from(closure.entries()).map(([moduleFilePath, reasons]) => ({
      moduleFilePath,
      reasons,
      source: moduleProvenance[moduleFilePath] ?? "missing",
    })),
    patchCount: patches.length,
    unappliablePatchCount: Object.keys(prepared.unappliablePatches).length,
    patchChainSynthesised: ctx.mode === "http",
    unresolvedImports: imported.unresolved,
    elidedPatchValues,
    includesBinaryFiles,
  };

  entries["manifest.json"] = JSON.stringify(manifest, null, 2);
  entries["report.json"] = JSON.stringify(report, null, 2);
  entries["README.md"] = renderReadme(manifest);

  return { manifest, report, entries };
}

/**
 * Validation errors as the studio would compute them: patches applied to the
 * evaluated json, then the schemas run over the result.
 */
async function validateSnapshotSources(
  ctx: DebugContext,
  analysis: PatchAnalysis & OrderedPatches,
): Promise<Record<string, unknown>> {
  const { serverOps } = ctx;
  const schemas = await serverOps.getSchemas();
  const validationRes = await serverOps.validateSources(
    schemas,
    (await serverOps.getSourcesWithPatchesApplied(analysis)).sources,
    analysis.patchesByModule,
  );
  return validationRes.errors;
}

function toSnapshotPatches(
  orderedPatches: {
    path: ModuleFilePath;
    patchId: PatchId;
    patch: unknown;
    createdAt: string;
    authorId: string | null;
    baseSha: string;
    appliedAt: { commitSha: string } | null;
  }[],
): SnapshotPatch[] {
  return orderedPatches.map((patch, i) => ({
    patchId: patch.patchId,
    path: patch.path,
    createdAt: patch.createdAt,
    authorId: patch.authorId,
    baseSha: patch.baseSha,
    appliedAt: patch.appliedAt,
    parentPatchId: i === 0 ? null : orderedPatches[i - 1].patchId,
    patch: patch.patch,
  }));
}

/**
 * The shape ValOpsFS writes per patch, so an unzipped snapshot is a patch store
 * a plain ValOpsFS can read. The directory is named after the PARENT, and
 * createPatchChain walks the linked list from "head".
 */
function toFsPatch(patch: SnapshotPatch) {
  return {
    patch: patch.patch,
    patchId: patch.patchId,
    parentRef:
      patch.parentPatchId === null
        ? { type: "head", headBaseSha: patch.baseSha }
        : { type: "patch", patchId: patch.parentPatchId },
    path: patch.path,
    authorId: patch.authorId,
    sessionId: null,
    baseSha: patch.baseSha,
    coreVersion: null,
    createdAt: patch.createdAt,
  };
}

async function writeBinaryFiles(
  ctx: DebugContext,
  fileLastUpdatedByPatchId: Record<
    string,
    { patchId: PatchId; remote: boolean; isDelete: boolean }
  >,
  patches: SnapshotPatch[],
  entries: Record<string, string>,
): Promise<boolean> {
  const parentByPatchId = new Map(
    patches.map((p) => [p.patchId, p.parentPatchId ?? "head"]),
  );
  let wrote = false;
  for (const [filePath, data] of Object.entries(fileLastUpdatedByPatchId)) {
    if (data.isDelete) {
      continue;
    }
    const parentPatchId = parentByPatchId.get(data.patchId);
    if (parentPatchId === undefined) {
      continue;
    }
    const buffer = await ctx.serverOps.getBase64EncodedBinaryFileFromPatch(
      filePath,
      data.patchId,
      data.remote,
    );
    if (!buffer) {
      continue;
    }
    // Base64 so the snapshot stays a text-only entry map; the replay decodes it.
    entries[
      `.val/patches/${parentPatchId}/files${filePath}/${path.posix.basename(filePath)}.base64`
    ] = buffer.toString("base64");
    wrote = true;
  }
  return wrote;
}

function generateValModules(moduleFilePaths: string[]): string {
  const imports = moduleFilePaths
    .map((moduleFilePath) => {
      const withoutExt = moduleFilePath.replace(/\.(ts|js|tsx|jsx)$/, "");
      return `  { def: () => import(".${withoutExt}") },`;
    })
    .join("\n");
  return `// GENERATED by \`val debug\`: trimmed to the modules this snapshot carries.
// The project's original is kept as val.modules.original.ts.
import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
${imports}
]);
`;
}

function renderReadme(manifest: SnapshotManifest): string {
  return `# Val debug snapshot

Captured ${manifest.generatedAt} from project \`${manifest.project ?? "(fs mode)"}\`,
branch \`${manifest.branch ?? "?"}\`, commit \`${manifest.commit ?? "?"}\`.

- @valbuild/core: \`${manifest.versions.core ?? "?"}\`
- @valbuild/next: \`${manifest.versions.next ?? "?"}\`
- ${manifest.patchCount} pending patches, ${manifest.unappliablePatchCount} of which could not be applied.

## Replaying it

This directory is a minimal Val project: the modules the patches touch (plus the
ones they reference), a generated \`val.modules.ts\`, and the patch chain under
\`.val/patches\`. Unzip it into \`debug/\` in the val repo, check out the version
above, and run:

\`\`\`bash
pnpm debug:replay debug/<this-directory>
\`\`\`

That applies the patches the same way \`/save\` does and validates the result, then
diffs what it finds against \`report.json\` (captured at the time of the bug).

## Notes

${manifest.patchChainSynthesised ? "- The content api does not return `parentRef`, so the patch chain was rebuilt from the order the api returned.\n" : ""}${manifest.unresolvedImports.length > 0 ? `- ${manifest.unresolvedImports.length} import specifier(s) could not be resolved to a project file - see manifest.json. Bare package imports are expected; a tsconfig path alias means the snapshot may not evaluate.\n` : ""}${manifest.elidedPatchValues.length > 0 ? `- ${manifest.elidedPatchValues.length} long patch value(s) were elided - see manifest.json.\n` : ""}${manifest.includesBinaryFiles ? "- Binary files are included, base64 encoded with a `.base64` suffix.\n" : "- Binary files are NOT included (source patching does not need them). Re-run with `--include-files` if you need them.\n"}
This snapshot contains unpublished content. Treat it as customer data.
`;
}

function toSnapshotPath(projectRelativePath: string): string {
  return projectRelativePath.replace(/^\//, "");
}

/** The @valbuild/* versions the project depends on, so we know what to check out. */
function readProjectValVersions(projectRoot: string): Record<string, string> {
  const contents = readLocalFile(projectRoot, "/package.json");
  if (contents === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object") {
    return {};
  }
  const versions: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = (parsed as Record<string, unknown>)[field];
    if (deps === null || typeof deps !== "object") {
      continue;
    }
    for (const [name, version] of Object.entries(deps)) {
      if (name.startsWith("@valbuild/") && typeof version === "string") {
        versions[name] = version;
      }
    }
  }
  return versions;
}

function readLocalFile(
  projectRoot: string,
  projectRelativePath: string,
): string | null {
  const absPath = path.join(projectRoot, projectRelativePath);
  try {
    return fs.readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Replaces oversized strings (base64 file payloads that were not swapped for a
 * hash) with a marker, so a snapshot stays small enough to attach.
 */
function elideLongStrings(value: unknown): {
  value: unknown;
  elided: string[][];
} {
  const elided: string[][] = [];
  const walk = (node: unknown, atPath: string[]): unknown => {
    if (typeof node === "string") {
      if (node.length > MAX_PATCH_STRING_LENGTH) {
        elided.push(atPath);
        return `<elided ${node.length} chars by val debug>`;
      }
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, atPath.concat(i.toString())));
    }
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, item]) => [
          key,
          walk(item, atPath.concat(key)),
        ]),
      );
    }
    return node;
  };
  return { value: walk(value, []), elided };
}
