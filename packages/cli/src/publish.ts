import pc from "picocolors";
import { error } from "./logger";
import { PublishProblem } from "@valbuild/shared/internal";
import { formatBytes, runPublish } from "./publish/runPublish";

/**
 * `val publish` - a built project in, a live site out.
 *
 * A thin shell around `runPublish`: everything it decides is decided there,
 * and everything colourful happens here. A CI job reads the exit code, a
 * person reads the lines.
 */
export async function publish(options: {
  root?: string;
  artifacts?: string;
  commit?: string;
  branch?: string;
  layerRev?: string;
  buildHash?: string;
  linksOwnCss?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  const result = await runPublish({
    ...(options.root ? { root: options.root } : {}),
    ...(options.artifacts ? { artifacts: options.artifacts } : {}),
    ...(options.commit ? { commit: options.commit } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.layerRev ? { layerRev: options.layerRev } : {}),
    ...(options.buildHash ? { buildHash: options.buildHash } : {}),
    ...(options.linksOwnCss === undefined
      ? {}
      : { linksOwnCss: options.linksOwnCss }),
    ...(options.dryRun ? { dryRun: options.dryRun } : {}),
    log: (line) => console.log(pc.dim(line)),
  });

  switch (result.status) {
    case "live":
    case "verified": {
      const uploaded =
        result.uploaded === 0
          ? "nothing new to upload"
          : `${result.uploaded} uploaded, ${formatBytes(result.uploadedBytes)}`;
      console.log(
        pc.green(
          result.status === "live"
            ? "✅ Published"
            : "✅ Verified (not published: --dry-run)",
        ) +
          pc.dim(
            ` — ${result.artifacts} artifact${result.artifacts === 1 ? "" : "s"}, ${uploaded}`,
          ),
      );
      if (result.status === "live" && result.url) {
        console.log(pc.cyan(result.url));
      }
      if (result.previewUrl) {
        console.log(pc.dim("Canary: ") + pc.cyan(result.previewUrl));
      }
      return;
    }
    case "failed": {
      error(result.message);
      for (const problem of result.problems) {
        printProblem(problem);
      }
      if (result.previewUrl) {
        console.error(pc.dim("Canary: ") + pc.cyan(result.previewUrl));
      }
      if (result.publishId) {
        console.error(
          pc.dim(
            `Publish ${result.publishId}${result.state ? ` is "${result.state}"` : ""}.`,
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    case "error": {
      error(result.message);
      process.exitCode = 1;
      return;
    }
  }
}

/**
 * A problem, as content wrote it.
 *
 * Verbatim, including the codes the build platform passed through: content
 * knows what went wrong with the canary and this does not, so rewording can
 * only lose the sentence that says what to change. The hint is printed for the
 * same reason - a gate that merely fails is useless.
 */
function printProblem(problem: PublishProblem) {
  console.error(
    pc.red(problem.code ? `  ${problem.code}: ` : "  ") + problem.message,
  );
  const keys = problem.keys ?? [];
  if (keys.length > 0) {
    const shown = keys.slice(0, 10).join(", ");
    console.error(
      pc.dim(
        `    ${shown}${keys.length > 10 ? `, and ${keys.length - 10} more` : ""}`,
      ),
    );
  }
  if (problem.hint) {
    console.error(pc.dim(`    ${problem.hint}`));
  }
}
