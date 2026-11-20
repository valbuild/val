import { type ReactNode, useEffect } from "react";
import { useValMode, useRefreshAIModels } from "../ValProvider";
import { useValConfig } from "../ValFieldProvider";
import { useValWebComponent } from "./ProjectSwitcher";
import { toAdminLinks, toWebComponentsUrl } from "./shellDataMapping";
import { type ValBuildAccess, useValBuildAccess } from "./useValBuildAccess";

/**
 * `<val-ai-setup>`, Val Build's AI key setup for THIS project: what the
 * assistant runs on, and adding, updating, choosing or removing a key —
 * each checked with the provider before it is saved (valbuild/home,
 * `web-components/src/ai-setup`).
 *
 * Mounted under the same rules as the project switcher and Members — a
 * connected project, and Val Build reachable (after `val login` locally) —
 * and otherwise nothing, since there is nowhere to set a key from. The
 * fallback is the project's AI tab in Val Build, by its stable link.
 *
 * When a key is saved or removed the element says so, and the assistant's
 * models are asked for again, so it comes on (or goes off) without a reload.
 */
export function AiSetup({
  className,
  unavailable = null,
  valBuild,
  loadScript,
}: {
  className?: string;
  /**
   * Whether Val Build can be reached, when the caller has asked already --
   * Settings has, for its Variables tab too. Without it this asks itself.
   */
  valBuild?: ValBuildAccess;
  /** What to show when it cannot be mounted (a project not connected). */
  unavailable?: ReactNode;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const config = useValConfig();
  const mode = useValMode();
  // "unknown" asks nothing: the caller's answer is used instead.
  const asked = useValBuildAccess(valBuild === undefined ? mode : "unknown");
  const access = valBuild ?? asked;
  const admin = toAdminLinks(config);
  const webComponentsUrl = toWebComponentsUrl(config);
  if (
    !access.connected ||
    admin === undefined ||
    webComponentsUrl === undefined
  ) {
    return <>{unavailable}</>;
  }
  return (
    <AiSetupElement
      className={className}
      project={config?.project ?? ""}
      aiHref={admin.ai}
      webComponentsUrl={webComponentsUrl}
      studioMode={access.studioMode}
      loadScript={loadScript}
    />
  );
}

export function AiSetupElement({
  className,
  project,
  aiHref,
  webComponentsUrl,
  studioMode,
  loadScript,
}: {
  className?: string;
  /** `org/name`. */
  project: string;
  aiHref: string;
  webComponentsUrl: string;
  studioMode?: "fs" | "http";
  loadScript?: (src: string) => Promise<void>;
}) {
  const ref = useValWebComponent(`${webComponentsUrl}/ai-setup.js`, loadScript);
  const refreshAiModels = useRefreshAIModels();

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onChanged = () => {
      void refreshAiModels();
    };
    element.addEventListener("val-ai-keys-changed", onChanged);
    return () => element.removeEventListener("val-ai-keys-changed", onChanged);
  }, [refreshAiModels]);

  return (
    <val-ai-setup
      ref={ref}
      className={className}
      project={project}
      api-base="/api/val/admin/proxy"
      mode={studioMode}
    >
      <a
        href={aiHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
      >
        Set up AI in Val Build
      </a>
    </val-ai-setup>
  );
}
