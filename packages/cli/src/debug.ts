import fs from "fs";
import path from "path";
import JSZip from "jszip";
import pc from "picocolors";
import { createDebugContext, DebugContextError } from "./debug/context";
import { buildSnapshot } from "./debug/snapshot";
import { printPatchReport } from "./debug/report";
import { error } from "./logger";

export async function debug(options: {
  root?: string;
  out?: string;
  commit?: string;
  branch?: string;
  remote?: boolean;
  includeFiles?: boolean;
  verbose?: boolean;
}): Promise<void> {
  let ctx;
  try {
    ctx = await createDebugContext(options);
  } catch (err) {
    if (err instanceof DebugContextError) {
      return error(err.message);
    }
    throw err;
  }

  console.log(
    pc.dim(
      `Project: ${ctx.project ?? "(fs mode)"}  branch: ${ctx.branch ?? "?"}  commit: ${ctx.commit ?? "?"}`,
    ),
  );
  console.log(
    pc.yellow(
      "The snapshot includes unpublished content. Only share it with Val developers.",
    ),
  );
  console.log("");

  const snapshot = await buildSnapshot(ctx, {
    includeFiles: options.includeFiles,
  });

  printPatchReport(
    snapshot.manifest.modules.length > 0 ? await readPatchMetadata(ctx) : [],
    snapshot.report,
    { verbose: options.verbose },
  );

  const outPath = path.resolve(
    options.out ??
      `./val-debug-${sanitize(ctx.branch ?? "nobranch")}-${(ctx.commit ?? "nocommit").slice(0, 8)}-${timestamp()}.zip`,
  );
  await writeZip(outPath, snapshot.entries);

  console.log("");
  console.log(`Snapshot written to ${pc.cyan(outPath)}`);
  for (const line of [
    `unzip ${path.basename(outPath)} -d debug/<name>`,
    `pnpm debug:replay debug/<name>`,
  ]) {
    console.log(pc.dim(`  ${line}`));
  }
  if (snapshot.manifest.unresolvedImports.length > 0) {
    console.log("");
    console.log(
      pc.yellow(
        `${snapshot.manifest.unresolvedImports.length} import(s) could not be resolved to a project file. ` +
          `Bare package imports are expected; a tsconfig path alias means the snapshot may not evaluate. See manifest.json.`,
      ),
    );
  }
}

/**
 * Patch metadata for the printed report. Fetched without ops so the (large)
 * patch bodies are not pulled a second time.
 */
async function readPatchMetadata(
  ctx: Awaited<ReturnType<typeof createDebugContext>>,
) {
  const res = await ctx.serverOps.fetchPatches({
    patchIds: undefined,
    excludePatchOps: true,
  });
  if (res.error) {
    return [];
  }
  return res.patches.map((patch) => ({
    patchId: patch.patchId,
    path: patch.path,
    createdAt: patch.createdAt,
    authorId: patch.authorId,
  }));
}

async function writeZip(
  outPath: string,
  entries: Record<string, string>,
): Promise<void> {
  const zip = new JSZip();
  for (const [entryPath, contents] of Object.entries(entries)) {
    zip.file(entryPath, contents);
  }
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
