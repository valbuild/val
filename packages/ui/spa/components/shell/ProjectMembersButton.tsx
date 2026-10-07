import { Users } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  ADMIN_PROXY,
  loadWebComponentScript,
  useLazyWebComponent,
} from "./ProjectSwitcher";
import { ShellBreakpoint } from "./types";

/**
 * Members: who can open this project, and for owners and developers a way to
 * add someone from the organization or take them off it.
 *
 * Since project members, being in the organization is not enough to open a
 * project: an owner, or someone chosen for it. This is where they are chosen,
 * from the Studio they are being let into. Share beside it is the
 * organization's members and invites; this is the project's.
 *
 * The button is the Studio's, and the panel is Val Build's
 * `<val-project-members>` around it (`trigger="slot"`), loaded on the first
 * hover or click — the same arrangement as Share and the project switcher
 * (see `ProjectSwitcher`). If the script cannot load, the click opens the
 * project's page in Val Build instead.
 */
export function ProjectMembersButton({
  projectName,
  projectHref,
  webComponentsUrl,
  studioMode,
  breakpoint,
  loadScript = loadWebComponentScript,
}: {
  /** `org/name`. */
  projectName: string;
  /** `toAdminLinks(...).project`: where to go when the panel cannot load. */
  projectHref: string;
  /** `toWebComponentsUrl`: `{contentHost}/wc/v1`. */
  webComponentsUrl: string;
  studioMode?: "fs" | "http";
  breakpoint: ShellBreakpoint;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const lazy = useLazyWebComponent({
    tag: "val-project-members",
    src: `${webComponentsUrl}/project-members.js`,
    fallbackHref: projectHref,
    loadScript,
  });
  const isMobile = breakpoint === "mobile";
  const name = projectName.split("/")[1] ?? projectName;

  return (
    <val-project-members
      ref={lazy.ref}
      className="inline-flex shrink-0"
      project={projectName}
      api-base={ADMIN_PROXY}
      layout={isMobile ? "sheet" : "popover"}
      trigger="slot"
      mode={studioMode}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={lazy.open}
        aria-label={isMobile ? `Members of ${name}` : undefined}
        title={`Members of ${name}`}
        onClick={lazy.onClick}
        onPointerEnter={lazy.prefetch}
        onFocus={lazy.prefetch}
        className={cn(
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
          "aria-expanded:bg-bg-float-raised aria-expanded:text-fg-primary",
          isMobile
            ? "grid place-items-center w-8 h-8 rounded-md"
            : "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md",
        )}
      >
        <Users size={isMobile ? 17 : 15} aria-hidden="true" />
        {!isMobile && <span className="text-[0.8125rem]">Members</span>}
      </button>
    </val-project-members>
  );
}
