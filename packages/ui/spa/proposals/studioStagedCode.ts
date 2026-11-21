import { createStudioPublishClient } from "@valbuild/shared/publish";
import { canBuildHere } from "../publish/handoff";
import { loadBuilder } from "../publish/loadBuilder";
import type { HostStore } from "../stores/HostStore";
import { evaluateTree } from "./evaluateTree";
import type { ProjectSnapshot } from "./projectSnapshot";
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
 *
 * The project is the chat's snapshot of it, which the staging that asked
 * for this was laid over: it used to be read again here, the proposal's
 * files and the site's whole source, for every evaluation.
 */
export function studioStagedCodeDeps(
  name: string,
  snapshot: Pick<ProjectSnapshot, "read">,
  /** The Studio's system, of which only the host is used: it takes the code. */
  system: { host: Pick<HostStore, "reloadCode"> },
): StagedCodeDeps {
  const publish = createStudioPublishClient({ api: "/api/val" });
  const project = stagedProject(name, snapshot);
  const buildHere = canBuildHere();
  /** Asked for beside the project, not after it. */
  let target: ReturnType<typeof publish.buildTarget> | null = null;
  return {
    project: () => {
      if (buildHere) {
        target = publish.buildTarget();
        // Its failure is the bundle's to report.
        target.catch(() => undefined);
      }
      return project();
    },
    bundle: buildHere
      ? async (files) =>
          (await loadBuilder()).bundleValModules({
            files,
            target: await (target ?? publish.buildTarget()),
            origin: window.location.origin,
          })
      : null,
    evaluate: (code) => evaluateTree(code, {}),
    importRegistry: importBundle,
    reloadCode: reloadStaged(system.host),
  };
}
