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
 * from the Studio they are being let into. Someone who is not in the
 * organization yet is invited from inside the panel ("Invite to {org}"), which
 * opens Val Build's organization members panel. The bar used to carry that
 * panel as a Share button of its own beside this one; two people buttons side
 * by side were one too many, so there is only this.
 *
 * The button is the Studio's, and the panel is Val Build's
 * `<val-project-members>` around it (`trigger="slot"`), loaded on the first
 * hover or click — the same arrangement as the project switcher (see
 * `ProjectSwitcher`). If the script cannot load, the click opens the
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

/** The org of an `org/name` project, or null for anything else. */
export function orgOfProject(projectName: string): string | null {
  const [org, name, ...rest] = projectName.split("/");
  return org && name && rest.length === 0 ? org : null;
}
