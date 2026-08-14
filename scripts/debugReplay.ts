/**
 * Replays a `val debug` snapshot against the currently checked-out source.
 *
 *   pnpm debug:replay debug/<snapshot-dir>
 *
 * Check out the @valbuild version from the snapshot's manifest.json first if you
 * want to reproduce on the code the customer was running.
 */
import fs from "fs";
import path from "path";
import {
  compareWithCapturedReport,
  readCapturedReport,
  replaySnapshot,
} from "../packages/server/src/debug/replaySnapshot";

async function main() {
  const snapshotDir = process.argv[2];
  if (!snapshotDir) {
    console.error("Usage: pnpm debug:replay <snapshot-dir>");
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(snapshotDir);
  const manifestPath = path.join(root, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    console.log(
      `Snapshot: project=${manifest.project ?? "(fs mode)"} branch=${manifest.branch} commit=${manifest.commit}`,
    );
    console.log(
      `Captured ${manifest.generatedAt} with @valbuild/core ${manifest.versions?.core}, @valbuild/next ${manifest.versions?.next}`,
    );
    if (manifest.versions?.project) {
      const declared = Object.entries(manifest.versions.project)
        .map(([name, version]) => `${name}@${version}`)
        .join(" ");
      if (declared) {
        console.log(`Project declared: ${declared}`);
      }
    }
    if (manifest.patchChainSynthesised) {
      console.log(
        "Note: the patch chain was rebuilt from the order the content api returned.",
      );
    }
    console.log("");
  }

  const result = await replaySnapshot(root);

  const byModule = new Map<string, typeof result.patches>();
  for (const patch of result.patches) {
    const existing = byModule.get(patch.moduleFilePath);
    if (existing) {
      existing.push(patch);
    } else {
      byModule.set(patch.moduleFilePath, [patch]);
    }
  }
  for (const moduleFilePath of Array.from(byModule.keys()).sort()) {
    const patches = byModule.get(moduleFilePath) ?? [];
    console.log(`${moduleFilePath} (${patches.length})`);
    for (const patch of patches) {
      const who = patch.authorId ?? "unknown author";
      if (patch.error) {
        console.log(
          `  FAIL ${patch.patchId} ${patch.createdAt} ${who}\n       ${patch.error.split("\n").join("\n       ")}`,
        );
      } else {
        console.log(`  ok   ${patch.patchId} ${patch.createdAt} ${who}`);
      }
    }
  }

  const validationErrorCount = Object.keys(result.validationErrors).length;
  console.log("");
  console.log(
    `${result.patches.length} patches, ${Object.keys(result.unappliablePatches).length} unappliable, ` +
      `${validationErrorCount} module(s) with validation errors.`,
  );
  if (validationErrorCount > 0) {
    console.log(JSON.stringify(result.validationErrors, null, 2));
  }

  const captured = readCapturedReport(root);
  if (captured) {
    const comparison = compareWithCapturedReport(result, captured);
    console.log("");
    if (comparison.reproduced) {
      console.log(
        `Reproduced: the same ${comparison.stillFailing.length} patch(es) fail here as at capture time.`,
      );
    } else {
      console.log("Differs from the captured report:");
      if (comparison.stillFailing.length > 0) {
        console.log(`  still failing: ${comparison.stillFailing.join(", ")}`);
      }
      if (comparison.nowApplying.length > 0) {
        console.log(
          `  now applying (fixed, or drift): ${comparison.nowApplying.join(", ")}`,
        );
      }
      if (comparison.newlyFailing.length > 0) {
        console.log(
          `  newly failing (regression): ${comparison.newlyFailing.join(", ")}`,
        );
      }
    }
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
