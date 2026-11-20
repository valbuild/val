import { createStudioPublishClient } from "@valbuild/shared/publish";
import { canBuildHere } from "../publish/handoff";
import { loadBuilder } from "../publish/loadBuilder";
import type { System } from "../stores/createSystem";
import { evaluateTree } from "./evaluateTree";
import type { ProposalsClient } from "./proposalsClient";
import {
  importBundle,
  reloadStaged,
  stagedProject,
  type StagedCodeDeps,
} from "./stagedCode";

/**
 * Evaluating a staging, run on this page: the builder it publishes with,
 * a worker for the first run, and this Studio's own realm for the second
 * (`evaluateStagedCode`). The bundle is made against the site's vendor
 * layer, served on this origin, as update with code makes it
 * (`studioCodeUpdateDeps`); and only where the page can run the builder.
 */
export function studioStagedCodeDeps(
  name: string,
  client: Pick<ProposalsClient, "files">,
  system: System,
): StagedCodeDeps {
  const publish = createStudioPublishClient({ api: "/api/val" });
  return {
    project: stagedProject(name, client, () => publish.projectSource()),
    bundle: canBuildHere()
      ? async (files) =>
          (await loadBuilder()).bundleValModules({
            files,
            target: await publish.buildTarget(),
            origin: window.location.origin,
          })
      : null,
    evaluate: (code) => evaluateTree(code, {}),
    importRegistry: importBundle,
    reloadCode: reloadStaged(system.host),
  };
}
