/**
 * A publish, from the Studio, end to end.
 *
 * `/save` has already committed by the time this runs, and that order is the
 * design rather than an accident: the commit needs nothing from the builder, so
 * doing it first puts the 10.9 MB wait AFTER durability instead of in front of
 * it. What is left is the part a managed project has nobody else to do —
 * read what to build and what to build it from, build it, and hand the result
 * to content.
 *
 * ## Everything it cannot do itself is a parameter
 *
 * There are four, and each is something this package must not contain:
 *
 * - **`client`** reaches content through this origin's proxy. A browser holds
 *   a session cookie and no project token; the deployment swaps the credential.
 * - **`loadBuilder`** is the dynamic import, replaceable because nothing that
 *   imports it for real runs under jest — `@rolldown/browser` is ESM-only and
 *   this repository's jest is CommonJS.
 * - **`generateRouteTree`** is TanStack's generator plus babel, which is 2.6 MB
 *   and is not on npm. See {@link StudioDeployOptions.generateRouteTree}.
 * - **`git`** is the commit `/save` just made, which only the caller saw.
 *
 * So this module is testable without any of them, which is the point: the
 * sequence is where the mistakes are, and the sequence is what is left.
 *
 * ## It does not throw
 *
 * Same rule as `runStudioPublish`, and for the same reason: every failure here
 * means one thing to an editor — nothing is live, and here is why — so a caller
 * that had to distinguish eight rejections would write eight identical
 * branches. The `problems` from content survive because they are the only part
 * a person can act on.
 */

import type { BuildOutput, BuildTarget } from "@valbuild/tanstack-build";
import { PublishProblem } from "@valbuild/shared/internal";
import { StudioPublishClient } from "./publishClient";
import {
  PublishPhase,
  StudioPublishResult,
  runStudioPublish,
} from "./runStudioPublish";
import { StudioBuilder } from "./loadBuilder";

/**
 * Where a project's route files live, if it has any.
 *
 * Spelled here rather than imported as `ROUTES_DIR` so this module keeps its
 * one runtime reach into the builder package behind `loadBuilder` — the
 * constant is four characters and the guard that says so is worth more. See
 * `onlyBuilderRoot.test.ts`.
 */
const ROUTES_PREFIX = "src/routes/";

export type DeployPhase =
  /** Waiting for the bundler. Only ever seen when the preload has not landed. */
  | { kind: "getting-ready" }
  | { kind: "reading" }
  | { kind: "building" }
  | PublishPhase;

export type StudioDeployResult =
  | { status: "live"; url: string | null }
  | { status: "already-live"; url: string | null }
  | {
      status: "failed";
      message: string;
      problems: PublishProblem[];
    };

export interface StudioDeployOptions {
  client: StudioPublishClient;
  /**
   * The commit `/save` just made, and the branch it is on.
   *
   * Baked into the generated `val.server.ts` before the build, which is not
   * bookkeeping: Val reads content from the content service AT A COMMIT, so a
   * build wired at the previous one renders and edits a different version of
   * its files than the code it is running. `null` for a project that publishes
   * from no commit at all.
   */
  git: { commit: string; branch: string } | null;
  loadBuilder: () => Promise<StudioBuilder>;
  /**
   * Generates `src/routeTree.gen.ts` for a file-based project.
   *
   * A capability, like `routeSplitter` and `loadCssModule` on `BuildInput` and
   * for the same reason: it is TanStack's generator over babel, it is 2.6 MB
   * built for a browser, and it is not published. A deployment that has one
   * supplies it.
   *
   * Absent, a file-based project is REFUSED by name. It would otherwise fail
   * inside rolldown with `UNRESOLVED_ENTRY`, because a file-based project's
   * entry IS the generated tree — a message about a module specifier, for a
   * missing capability, several layers from anything anyone can act on.
   */
  generateRouteTree?: (
    files: Record<string, string>,
  ) => Promise<Record<string, string>>;
  onPhase: (phase: DeployPhase) => void;
}

export async function runStudioDeploy(
  options: StudioDeployOptions,
): Promise<StudioDeployResult> {
  const { client, onPhase } = options;
  const failed = (message: string): StudioDeployResult => ({
    status: "failed",
    message,
    problems: [],
  });

  let builder: StudioBuilder;
  try {
    onPhase({ kind: "getting-ready" });
    builder = await options.loadBuilder();
  } catch (error) {
    return failed(messageOf(error));
  }

  let target: BuildTarget;
  let source: Record<string, string>;
  try {
    onPhase({ kind: "reading" });
    /*
     * Together, because they are one answer with two halves and neither is
     * useful alone -- and because the round trip is the cost, not the work.
     */
    const [readTarget, readSource] = await Promise.all([
      client.buildTarget(),
      client.projectSource(),
    ]);
    if (readSource === null) {
      return failed(
        "This project has no published source to build from. Publish it once " +
          "from a checkout before editing it here.",
      );
    }
    if (readTarget.project.rev === null) {
      /*
       * A dependency layer is built from `node_modules` by the `/node` half of
       * the builder, which cannot run in a browser -- so this is not something
       * a retry or a different edit can resolve, and saying "the build failed"
       * would send someone looking at their content.
       */
      return failed(
        "This project has no dependency layer yet, and one cannot be built " +
          "from the browser. Publish it once from a checkout, which builds it.",
      );
    }
    target = readTarget;
    source = readSource;
  } catch (error) {
    return failed(messageOf(error));
  }

  let build: BuildOutput;
  try {
    onPhase({ kind: "building" });
    /*
     * The commit goes in BEFORE the build, and into the record that is
     * published back as source -- so the next publish reads it back and the
     * two never disagree about which commit this build is wired at.
     */
    const wired = builder.rebakeGit(source, options.git);
    const fileBased = Object.keys(wired).some((path) =>
      path.startsWith(ROUTES_PREFIX),
    );
    /*
     * Read out before the branch, so the guard below and the call are the same
     * narrowing rather than two that agree by inspection.
     */
    const generateRouteTree = options.generateRouteTree;
    if (fileBased && generateRouteTree === undefined) {
      return failed(
        "This project's pages are files under src/routes, and building those " +
          "needs a route generator this page was not given. Publish it from a " +
          "checkout, or mount the Studio in a deployment that supplies one.",
      );
    }
    build = await builder.buildUserApp({
      files:
        fileBased && generateRouteTree !== undefined
          ? await generateRouteTree(wired)
          : wired,
      /*
       * The project's OWN files, without the generated tree.
       *
       * This is what the app reads back as its source and what the next
       * publish starts from, so a generated file in here comes back as
       * content somebody wrote.
       */
      projectSource: wired,
      target,
    });
  } catch (error) {
    return failed(messageOf(error));
  }

  let artifacts;
  try {
    artifacts = await builder.publishArtifacts(build);
  } catch (error) {
    return failed(messageOf(error));
  }

  const published = await runStudioPublish({
    client,
    artifacts,
    declare: {
      buildHash: build.hash,
      commit: options.git?.commit ?? null,
      branch: options.git?.branch ?? null,
      layerRev: target.project.rev,
      linksOwnCss: build.linksOwnCss,
      artifacts: artifacts.map(({ key, sha256, bytes }) => ({
        key,
        sha256,
        bytes,
      })),
    },
    onPhase,
  });
  return asDeployResult(published);
}

const asDeployResult = (published: StudioPublishResult): StudioDeployResult => {
  switch (published.status) {
    case "live":
      return { status: "live", url: published.url };
    case "already-live":
      return { status: "already-live", url: published.url };
    case "failed":
      return {
        status: "failed",
        message: published.message,
        problems: published.problems,
      };
  }
};

/**
 * A thrown thing, as a sentence.
 *
 * `String(error)` on an Error gives `Error: ...`, which reads as a stack trace
 * leaking into the page. The message alone is what was written for a person.
 */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
