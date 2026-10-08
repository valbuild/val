import path from "path";
import pc from "picocolors";
import { error } from "./logger";
import { PublishProblem } from "@valbuild/shared/internal";
import { formatBytes, runPublish } from "./publish/runPublish";
import { validateOnce } from "./validate";

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
  skipValidation?: boolean;
}): Promise<void> {
  // Content that does not validate is not published. This is the check that
  // lets the Studio trust a connected project's published content without
  // re-checking every file itself: whatever reached the site went through
  // here. Without `--fix`, so CI never rewrites what it was asked to publish.
  if (!options.skipValidation) {
    const projectRoot = options.root
      ? path.resolve(options.root)
      : process.cwd();
    const errorCount = await validateOnce({ projectRoot, fix: false });
    if (errorCount > 0) {
      error(
        `Not published: ${errorCount} validation error${errorCount === 1 ? "" : "s"}.`,
      );
      console.error(
        pc.dim(
          `    Run "val validate --fix" in the project, commit what it changes and push, ` +
            `and fix by hand what it cannot. --skip-validation publishes anyway.`,
        ),
      );
      process.exitCode = 1;
      return;
    }
  }

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
    case "superseded": {
      // Content's sentence says it all: a newer publish is live and has this.
      console.log(pc.green("✅ ") + result.message);
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
