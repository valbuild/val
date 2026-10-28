import type { BuildOutput } from "@valbuild/tanstack-build";
import type { BuildTargetResponse } from "../internal";
import type { QuickPreviewFiles } from "../internal/quickPreview";
import type { StudioBuilder } from "./builder";
import { withoutLockfiles } from "./buildProposal";
import { proposalProject } from "./proposalProject";

/*
 * A quick preview's files: the proposal's app bundled in the tab, for the
 * browser half only (`quickPreview.ts` in `../internal` says what a quick
 * preview is and what it cannot show). Nothing is uploaded and nothing is
 * served: the files go to the page in the preview, whose worker hands them to
 * a page opened as the preview.
 */

/** Where a site's routes live: the generator is needed when there are any. */
const ROUTES_PREFIX = "src/routes/";

export type QuickPreviewOutcome =
  | {
      status: "built";
      files: QuickPreviewFiles;
      /** What the proposal's files were staged as: the build is of these. */
      inputs: string | null;
    }
  | { status: "failed"; message: string };

export async function buildQuickPreview(deps: {
  name: string;
  /** The proposal's files, and what they build on. */
  proposals: {
    files(name: string): Promise<{
      files: Record<string, string | null>;
      staged: { inputs: string | null };
    }>;
    buildTarget(
      name: string,
    ): Promise<{ target: BuildTargetResponse; layer: "site" | "own" }>;
  };
  /** The site's source, which the proposal's files are laid over. */
  siteSource: () => Promise<Record<string, string> | null>;
  /** The site's build target: what the proposal's address serves. */
  siteTarget: () => Promise<BuildTargetResponse>;
  loadBuilder: () => Promise<StudioBuilder>;
  /** Generates `src/routeTree.gen.ts`: see `runStudioDeploy`. */
  generateRouteTree?: (
    files: Record<string, string>,
  ) => Promise<Record<string, string>>;
  /** Each step as it begins: for the tab's progress and timings. */
  onStep?: (label: string) => void;
  signal?: AbortSignal;
}): Promise<QuickPreviewOutcome> {
  const step = deps.onStep ?? (() => {});
  const failed = (message: string): QuickPreviewOutcome => ({
    status: "failed",
    message,
  });
  const stopped = () =>
    deps.signal?.aborted ? failed("The quick preview was cancelled.") : null;
  try {
    step("Reading the proposal");
    const [read, site, asked] = await Promise.all([
      deps.proposals.files(deps.name),
      deps.siteSource(),
      deps.proposals.buildTarget(deps.name).catch(() => null),
    ]);
    if (site === null) {
      return failed(
        "The site has no published source to build a preview from. Build the proposal instead.",
      );
    }
    if (asked?.layer === "own") {
      return failed(
        "This proposal changes the site's dependencies, which a quick preview cannot load. Build the proposal to see it.",
      );
    }
    const target = await deps.siteTarget();
    if (target.project.rev === null) {
      return failed(
        "The site has no dependency layer yet. Build the proposal to see it.",
      );
    }
    const stoppedNow = stopped();
    if (stoppedNow !== null) return stoppedNow;

    step("Loading the builder");
    const builder = await deps.loadBuilder();
    const project = withoutLockfiles(proposalProject(site, read.files));
    const fileBased = Object.keys(project).some((path) =>
      path.startsWith(ROUTES_PREFIX),
    );
    if (fileBased && deps.generateRouteTree === undefined) {
      return failed(
        "This page cannot generate the site's route tree, so it cannot build a preview. Build the proposal instead.",
      );
    }
    step("Building");
    const files =
      fileBased && deps.generateRouteTree !== undefined
        ? await deps.generateRouteTree(project)
        : project;
    const stoppedBeforeBuild = stopped();
    if (stoppedBeforeBuild !== null) return stoppedBeforeBuild;
    const build = await builder.buildUserApp({
      files,
      publicFiles: {},
      assets: {},
      projectSource: project,
      target,
      extraInputs: {},
    });
    const stoppedAfterBuild = stopped();
    if (stoppedAfterBuild !== null) return stoppedAfterBuild;
    return {
      status: "built",
      files: clientFilesOf(build),
      inputs: read.staged.inputs,
    };
  } catch (error) {
    return (
      stopped() ??
      failed(error instanceof Error ? error.message : String(error))
    );
  }
}

/**
 * The browser half of a build, as the worker serves it under `/_app/`. The
 * stylesheet only when the tab compiled one: an empty one is the case where a
 * build ships the site's live stylesheet (`liveStylesheet` on
 * `runStudioDeploy`), and the page already has that.
 */
export function clientFilesOf(build: BuildOutput): QuickPreviewFiles {
  const files: QuickPreviewFiles = {
    "app.js": { body: build.clientCode, contentType: JS },
  };
  for (const [name, code] of Object.entries(build.clientChunks)) {
    files[name] = { body: code, contentType: JS };
  }
  if (build.cssCode !== "") {
    files["app.css"] = { body: build.cssCode, contentType: "text/css" };
  }
  for (const [name, base64] of Object.entries(build.assetFiles)) {
    files[`a/${name}`] = {
      body: base64,
      contentType: contentTypeOf(name),
      base64: true,
    };
  }
  return files;
}

const JS = "text/javascript; charset=utf-8";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  json: "application/json",
  txt: "text/plain",
};

function contentTypeOf(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
