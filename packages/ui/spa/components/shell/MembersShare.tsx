import { UserPlus } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  ADMIN_PROXY,
  loadWebComponentScript,
  useLazyWebComponent,
} from "./ProjectSwitcher";
import { ShellBreakpoint } from "./types";

/**
 * Share: who is in the organization, and a panel to invite people, revoke
 * pending links and change roles.
 *
 * The button is the Studio's, drawn like Review beside it, and the panel is
 * Val Build's `<val-members>` around it (`trigger="slot"`), loaded when the
 * button is first hovered or clicked — the same arrangement as the project
 * switcher, for the same reasons (see `ProjectSwitcher`). If the script cannot
 * load, the click opens the members page in Val Build instead, which is what
 * Share did before there was a panel for it.
 *
 * On a phone it is an icon at the top right, opening a sheet; above that it is
 * "Share", left of the locale menu.
 */
export function MembersShare({
  org,
  membersHref,
  webComponentsUrl,
  studioMode,
  breakpoint,
  loadScript = loadWebComponentScript,
}: {
  org: string;
  /** `toAdminLinks(...).members`. */
  membersHref: string;
  /** `toWebComponentsUrl`: `{appHost}/wc/v1`. */
  webComponentsUrl: string;
  studioMode?: "fs" | "http";
  breakpoint: ShellBreakpoint;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const lazy = useLazyWebComponent({
    tag: "val-members",
    src: `${webComponentsUrl}/members.js`,
    fallbackHref: membersHref,
    loadScript,
  });
  const isMobile = breakpoint === "mobile";

  return (
    <val-members
      ref={lazy.ref}
      className="inline-flex shrink-0"
      org={org}
      api-base={ADMIN_PROXY}
      layout={isMobile ? "sheet" : "popover"}
      trigger="slot"
      mode={studioMode}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={lazy.open}
        aria-label={isMobile ? `Share ${org}` : undefined}
        title={`Share ${org}`}
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
        <UserPlus size={isMobile ? 17 : 15} aria-hidden="true" />
        {!isMobile && <span className="text-[0.8125rem]">Share</span>}
      </button>
    </val-members>
  );
}

/** The org of an `org/name` project, or null for anything else. */
export function orgOfProject(projectName: string): string | null {
  const [org, name, ...rest] = projectName.split("/");
  return org && name && rest.length === 0 ? org : null;
}
