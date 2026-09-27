/**
 * Updating a managed project's dependencies, from the Studio.
 *
 * A managed project is a copy of its template taken once, when it was
 * created, and nothing moves it forward on its own: the Studio can rebuild a
 * project's code, but not the layer its dependencies are built into, because
 * that needs `node_modules` and a browser has none. The platform keeps the
 * template's own build current instead -- it is rebuilt on every deploy -- and
 * an update moves the project onto THAT build's dependencies.
 *
 * So an update is three things, in order, and only the first is new:
 *
 * 1. **Start it.** Content copies the template's dependency layer into the
 *    project and answers with the project's `package.json` rewritten to the
 *    template's versions, the build target that carries that layer, and the
 *    branch head to build at.
 * 2. **Rebuild the site, here.** The same `deploy` a publish runs, with three
 *    differences: nothing was saved first (so no content is published -- an
 *    editor's unpublished changes stay unpublished), the only file laid over
 *    the stored source is `package.json`, and the build target is the one from
 *    step 1 rather than the live build's.
 * 3. **Publish it.** Also the ordinary publish, so the site is checked before
 *    it goes live: a rebuild that does not render is refused and the site stays
 *    as it was, on its old dependencies.
 *
 * The builder is THIS Studio's, which is the old version of Val. That is
 * deliberate rather than overlooked: verify is what stands between a builder
 * and a Val it does not know, and the next publish -- from the Studio the
 * update brought -- rebuilds with the new one.
 *
 * ## It does not throw
 *
 * For the reason `runStudioDeploy` does not: it runs behind a click, and a
 * rejection there is a spinner nobody can stop.
 */

import type { DependencyChange } from "@valbuild/shared/internal";
import type { StudioPublishClient } from "./publishClient";
import type { StudioDeployOutcome, UseStudioDeploy } from "./useStudioDeploy";

/** The one file an update changes. */
export const PACKAGE_JSON = "package.json";

export type SiteUpdateOutcome =
  /** Live on the new dependencies. The Studio on screen is still the old one. */
  | { status: "updated"; changes: DependencyChange[] }
  /** Nothing to update to, after all -- somebody else updated first. */
  | { status: "current" }
  /** The platform will not update this project, and says why. */
  | { status: "unavailable"; message: string }
  /**
   * The rebuild or its publish failed. The site is unchanged: nothing moves
   * it but a publish that passed its check.
   */
  | {
      status: "failed";
      message: string;
      /** The technical half, for the details under the sentence. */
      details: string;
      deploy: StudioDeployOutcome | null;
    };

export async function runSiteUpdate(options: {
  client: Pick<StudioPublishClient, "updateTarget">;
  deploy: UseStudioDeploy["deploy"];
}): Promise<SiteUpdateOutcome> {
  let answer;
  try {
    answer = await options.client.updateTarget("start");
  } catch (error) {
    return {
      status: "failed",
      message: "The update could not be started. Nothing on the site changed.",
      details: messageOf(error),
      deploy: null,
    };
  }
  if (answer.status === "current") return { status: "current" };
  if (answer.status === "unavailable") {
    return { status: "unavailable", message: answer.message };
  }
  if (answer.target === undefined) {
    /*
     * A start with no target is a content service answering a POST as though
     * it were a GET. Building against the live target would publish the old
     * dependencies and report an update.
     */
    return {
      status: "failed",
      message: "The update could not be started. Nothing on the site changed.",
      details: "The update answer carried no build target.",
      deploy: null,
    };
  }

  const outcome = await options.deploy(
    answer.commit,
    { [PACKAGE_JSON]: answer.packageJson },
    { binaryFiles: null, branch: answer.branch, target: answer.target },
  );
  if (outcome.result.status === "failed") {
    return {
      status: "failed",
      message:
        outcome.failedAt === "verifying"
          ? "The updated site did not pass its check, so it was not published. Your site is unchanged."
          : "The update could not be published. Your site is unchanged.",
      details: [
        outcome.result.message,
        ...outcome.result.problems.map(
          (problem) =>
            `${problem.code}: ${problem.message}${problem.hint ? ` (${problem.hint})` : ""}`,
        ),
      ].join("\n"),
      deploy: outcome,
    };
  }
  return { status: "updated", changes: answer.changes };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
