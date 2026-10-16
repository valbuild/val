import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import {
  sideFiles,
  sideSource,
  type BuildTargetResponse,
  type Evaluated,
  type Side,
} from "@valbuild/shared/internal";
import type { StudioBuilder } from "../publish/loadBuilder";
import type {
  CodeResolution,
  ProposalJson,
  ProposalsClient,
  UpdateConflict,
  UpdateResolution,
} from "./proposalsClient";

/**
 * Update from the site, for a proposal with code (valbuild/home
 * `docs/hosted-publishing.md` step 8.2, slice 1b), as the tab runs it:
 *
 * 1. content's three trees (`mergeTrees`);
 * 2. each one's `val.modules.ts` bundled by the builder and evaluated in a
 *    worker of its own -- the site's own dependencies, from its vendor layer
 *    -- for its schemas, and the errors of each module's Source under them;
 * 3. Val's server merges (`updateCode`), and answers the merge for this tab
 *    to evaluate in turn, or the conflicts for a person;
 * 4. the merge evaluated, and sent back: the server checks it and commits it.
 *
 * What the merge staged then needs a build, as any staged code does.
 */

export type CodeUpdateDeps = {
  client: Pick<ProposalsClient, "mergeTrees" | "updateCode">;
  buildTarget: () => Promise<BuildTargetResponse>;
  bundle: StudioBuilder["bundleValModules"];
  evaluate: (
    code: string,
    sources: Record<string, JSONValue | null>,
  ) => Promise<Evaluated>;
  /** The site's origin, where its vendor chunks are served. */
  origin: string;
  onPhase?: (phase: CodeUpdatePhase) => void;
};

export type CodeUpdatePhase = "reading" | "evaluating" | "merging" | "checking";

export type CodeUpdateOutcome =
  | { status: "up-to-date" }
  | { status: "conflicts"; conflicts: UpdateConflict[] }
  | { status: "updated"; proposal: ProposalJson };

export async function updateProposalWithCode(
  name: string,
  resolutions: (UpdateResolution | CodeResolution)[],
  deps: CodeUpdateDeps,
): Promise<CodeUpdateOutcome> {
  deps.onPhase?.("reading");
  const [trees, target] = await Promise.all([
    deps.client.mergeTrees(name),
    deps.buildTarget(),
  ]);
  if (trees.upToDate) return { status: "up-to-date" };

  const evaluateFiles = async (
    files: Record<string, string>,
    sources: Record<string, JSONValue | null>,
  ) => {
    const { code } = await deps.bundle({ files, target, origin: deps.origin });
    return deps.evaluate(code, sources);
  };
  deps.onPhase?.("evaluating");
  const evaluated: Record<Side, Evaluated> = {
    base: {},
    site: {},
    proposal: {},
  };
  for (const side of ["base", "site", "proposal"] as const) {
    const sources: Record<string, JSONValue | null> = {};
    for (const path of Object.keys(trees.modules)) {
      sources[path] = sideSource(trees, side, path as ModuleFilePath);
    }
    evaluated[side] = await evaluateFiles(sideFiles(trees, side), sources);
  }

  deps.onPhase?.("merging");
  const request = {
    siteHead: trees.siteHead,
    proposalHead: trees.proposalHead,
    builds: trees.builds,
    evaluated,
    resolutions,
  };
  const first = await deps.client.updateCode(name, request);
  if (first.status !== "evaluate") return outcomeOf(first);

  deps.onPhase?.("checking");
  const merged: Record<string, string> = { ...trees.trees.site };
  for (const [path, text] of Object.entries(first.files)) {
    if (text === null) delete merged[path];
    else merged[path] = text;
  }
  const second = await deps.client.updateCode(name, {
    ...request,
    merged: {
      id: first.id,
      evaluated: await evaluateFiles(merged, first.sources),
    },
  });
  if (second.status === "evaluate") {
    throw new Error(
      "Val's server asked for the update to be checked twice. Update from the site again.",
    );
  }
  return outcomeOf(second);
}

function outcomeOf(
  answer:
    | { status: "up-to-date" }
    | { status: "conflicts"; conflicts: UpdateConflict[] }
    | { status: "updated"; proposal: ProposalJson },
): CodeUpdateOutcome {
  switch (answer.status) {
    case "up-to-date":
      return { status: "up-to-date" };
    case "conflicts":
      return { status: "conflicts", conflicts: answer.conflicts };
    case "updated":
      return { status: "updated", proposal: answer.proposal };
  }
}
