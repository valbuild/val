import readline from "readline";
import pc from "picocolors";
import { PatchId } from "@valbuild/core";
import { OrderedPatches, PatchAnalysis } from "@valbuild/server";
import { createDebugContext, DebugContextError } from "./debug/context";
import { printPatchReport } from "./debug/report";
import { error, info } from "./logger";

/**
 * Removes the pending patches that cannot be applied, which is what unblocks a
 * publish that fails with "Failed to create commit".
 *
 * Deliberately a separate command from `val debug`: capturing a snapshot must
 * always be read-only, and deleting destroys the evidence - so take the snapshot
 * first.
 */
export async function deleteUnappliablePatches(options: {
  root?: string;
  commit?: string;
  branch?: string;
  remote?: boolean;
  dryRun?: boolean;
  yes?: boolean;
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

  const first = await analyse(ctx);
  if (first === null) {
    return;
  }
  printPatchReport(first.metadata, first.prepared, {
    verbose: options.verbose,
  });
  const unappliablePatchIds = Object.keys(
    first.prepared.unappliablePatches,
  ).map((patchId) => patchId as PatchId);
  if (unappliablePatchIds.length === 0) {
    return;
  }
  if (options.dryRun) {
    console.log("");
    info("Dry run: nothing was deleted.");
    return;
  }
  if (!options.yes) {
    console.log("");
    const confirmed = await confirm(
      `Delete ${unappliablePatchIds.length} patch(es)? The changes they contain are lost. [y/N] `,
    );
    if (!confirmed) {
      info("Aborted, nothing was deleted.");
      return;
    }
  }

  const deleteRes = await ctx.serverOps.deletePatches(unappliablePatchIds);
  if (deleteRes.errors && Object.keys(deleteRes.errors).length > 0) {
    for (const [patchId, err] of Object.entries(deleteRes.errors)) {
      error(`Could not delete ${patchId}: ${err.message}`);
    }
    return;
  }
  info(`Deleted ${unappliablePatchIds.length} patch(es).`, { isGood: true });

  console.log("");
  console.log(pc.dim("Re-checking the remaining chain..."));
  const second = await analyse(ctx);
  if (second === null) {
    return;
  }
  const stillUnappliable = Object.keys(second.prepared.unappliablePatches);
  if (stillUnappliable.length === 0) {
    info(
      `The remaining ${second.metadata.length} patch(es) all apply. Publishing should work now.`,
      { isGood: true },
    );
    return;
  }
  printPatchReport(second.metadata, second.prepared, {
    verbose: options.verbose,
  });
  error(
    `${stillUnappliable.length} patch(es) still cannot be applied. Run the command again to remove them too.`,
  );
}

async function analyse(ctx: Awaited<ReturnType<typeof createDebugContext>>) {
  const patchesRes = await ctx.serverOps.fetchPatches({
    patchIds: undefined,
    excludePatchOps: false,
  });
  if (patchesRes.error) {
    error(`Could not fetch patches: ${patchesRes.error.message}`);
    return null;
  }
  const analysis: PatchAnalysis & OrderedPatches = {
    ...ctx.serverOps.analyzePatches(patchesRes.patches),
    ...patchesRes,
  };
  const prepared = await ctx.serverOps.prepare(analysis, {
    continueOnError: true,
  });
  return {
    prepared,
    metadata: patchesRes.patches.map((patch) => ({
      patchId: patch.patchId,
      path: patch.path,
      createdAt: patch.createdAt,
      authorId: patch.authorId,
    })),
  };
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
