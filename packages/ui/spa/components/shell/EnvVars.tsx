import { useValMode } from "../ValProvider";
import { useValConfig } from "../ValFieldProvider";
import { useValWebComponent } from "./ProjectSwitcher";
import { toEnvVarsHref, toWebComponentsUrl } from "./shellDataMapping";
import { useValBuildAccess } from "./useValBuildAccess";

/**
 * `<val-env-vars>`, Val Build's variables and secrets for THIS project: what
 * its hosted site reads at runtime, as `process.env.NAME` on the server and
 * `import.meta.env.PUBLIC_NAME` in the browser (valbuild/home,
 * `web-components/src/env-vars`, and `docs/env-vars.md`).
 *
 * Mounted under the same rules as the AI setup -- a connected project, and
 * Val Build reachable (after `val login` locally) -- and otherwise not at
 * all: `useEnvVarsTarget` is null, and Settings has no Variables tab. The
 * element itself says when the project runs on its own hosting, where these
 * are set at the host instead. Its fallback is the project's Variables
 * section in Val Build, by its stable link.
 *
 * A secret typed here is sealed in the element, before it leaves the page:
 * the Studio's own proxy (`/api/val/admin/proxy`) only ever forwards it
 * sealed.
 */
export type EnvVarsTarget = {
  /** `org/name`. */
  project: string;
  envHref: string;
  webComponentsUrl: string;
  studioMode?: "fs" | "http";
};

export function useEnvVarsTarget(): EnvVarsTarget | null {
  const config = useValConfig();
  const mode = useValMode();
  const valBuild = useValBuildAccess(mode);
  const envHref = toEnvVarsHref(config);
  const webComponentsUrl = toWebComponentsUrl(config);
  if (
    !valBuild.connected ||
    envHref === undefined ||
    webComponentsUrl === undefined
  ) {
    return null;
  }
  return {
    project: config?.project ?? "",
    envHref,
    webComponentsUrl,
    studioMode: valBuild.studioMode,
  };
}

export function EnvVarsElement({
  className,
  project,
  envHref,
  webComponentsUrl,
  studioMode,
  loadScript,
}: EnvVarsTarget & {
  className?: string;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const ref = useValWebComponent(`${webComponentsUrl}/env-vars.js`, loadScript);
  return (
    <val-env-vars
      ref={ref}
      className={className}
      project={project}
      api-base="/api/val/admin/proxy"
      mode={studioMode}
    >
      <a
        href={envHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
      >
        Variables and secrets in Val Build
      </a>
    </val-env-vars>
  );
}
