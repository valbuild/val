import { useStudioDeployState } from "../ValProvider";
import { useSiteUpdate } from "../../publish/useSiteUpdate";
import { canBuildHere } from "../../publish/handoff";
import { SiteUpdateSection } from "./SiteUpdateSection";

/**
 * Updating the site's dependencies, for a project whose code the Studio
 * builds.
 *
 * Here rather than in admin because the Studio is what builds and publishes a
 * managed project, and an update is a rebuild and a publish. Not CONTENT, unlike
 * the sections around it: nothing here is a draft and nothing shows up in the
 * publish diff. It is in this panel because this is where anybody looks for
 * "the project's settings".
 *
 * Shown only for a managed project (see `ValShell`). A connected project's
 * dependencies are its repository's.
 */
export function ValSiteUpdate() {
  const deploy = useStudioDeployState();
  const { view, check, update } = useSiteUpdate({ deploy });
  return (
    <SiteUpdateSection
      view={view}
      canBuild={canBuildHere()}
      onUpdate={update}
      onRetry={check}
      onReload={() => window.location.reload()}
    />
  );
}
