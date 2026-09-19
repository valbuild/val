import pc from "picocolors";
import { error } from "./logger";
import { formatBytes, runPublish } from "./publish/runPublish";

/**
 * `val publish` - build output in, live site out.
 *
 * The command is a thin shell around `runPublish`: everything it decides is
 * decided there, and everything colourful happens here. A CI job reads the
 * exit code, a person reads the lines.
 */
export async function publish(options: {
  root?: string;
  dir?: string;
  commit?: string;
  branch?: string;
  dryRun?: boolean;
}): Promise<void> {
  const result = await runPublish({
    ...(options.root ? { root: options.root } : {}),
    ...(options.dir ? { dir: options.dir } : {}),
    ...(options.commit ? { commit: options.commit } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.dryRun ? { dryRun: options.dryRun } : {}),
    log: (line) => console.log(pc.dim(line)),
  });

  switch (result.status) {
    case "published":
    case "verified": {
      const uploaded =
        result.uploaded === 0
          ? "nothing new to upload"
          : `${result.uploaded} uploaded, ${formatBytes(result.uploadedBytes)}`;
      console.log(
        pc.green(
          result.status === "published"
            ? "✅ Published"
            : "✅ Verified (not published: --dry-run)",
        ) +
          pc.dim(
            ` — ${result.artifacts} artifact${result.artifacts === 1 ? "" : "s"}, ${uploaded}`,
          ),
      );
      if (result.url) {
        console.log(pc.cyan(result.url));
      }
      return;
    }
    case "failed": {
      error(result.message);
      for (const problem of result.problems) {
        // Verbatim: content knows what went wrong with the canary and this
        // does not, so paraphrasing it can only lose the sentence that helps.
        console.error(
          pc.red(problem.code ? `  ${problem.code}: ` : "  ") + problem.message,
        );
        if (problem.detail) {
          console.error(pc.dim(`    ${problem.detail}`));
        }
      }
      console.error(
        pc.dim(`Publish ${result.publishId} is in state "${result.state}".`),
      );
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
