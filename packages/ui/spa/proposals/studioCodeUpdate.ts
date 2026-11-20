import { loadBuilder } from "../publish/loadBuilder";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import { evaluateTree } from "./evaluateTree";
import type { ProposalsClient } from "./proposalsClient";
import type { CodeUpdateDeps, CodeUpdatePhase } from "./updateWithCode";

/**
 * Update from the site with code, run on this page: the builder it publishes
 * with, a worker per tree, and this deployment's build target -- the site's
 * vendor layer, served on this origin. Only where the page can build
 * (`canBuildHere`): the builder needs it.
 */
export function studioCodeUpdateDeps(
  client: Pick<ProposalsClient, "mergeTrees" | "updateCode">,
  onPhase?: (phase: CodeUpdatePhase) => void,
): CodeUpdateDeps {
  const publish = createStudioPublishClient({ api: "/api/val" });
  return {
    client,
    buildTarget: () => publish.buildTarget(),
    bundle: async (input) => (await loadBuilder()).bundleValModules(input),
    evaluate: evaluateTree,
    origin: window.location.origin,
    ...(onPhase ? { onPhase } : {}),
  };
}
