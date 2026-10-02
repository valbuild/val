import { UserPlus } from "lucide-react";
import { loadWebComponentScript, useValWebComponent } from "./ProjectSwitcher";
import { ShellBreakpoint } from "./types";

/**
 * `<val-members>`, Val Build's Share button: who is in the organization, and
 * a panel to invite people, revoke pending links and change roles.
 *
 * Mounted under the same rules as `<val-project-switcher>` and for the same
 * reasons — see `ProjectSwitcher`. The fallback is a link to the members page
 * in Val Build, which is what Share did before there was a panel for it.
 *
 * On a phone it is an icon at the top right, where it sits beside the account;
 * above that it is the avatars, the count and "Share".
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
  const ref = useValWebComponent(`${webComponentsUrl}/members.js`, loadScript);
  const isMobile = breakpoint === "mobile";

  return (
    <val-members
      ref={ref}
      className="inline-flex shrink-0"
      org={org}
      api-base="/api/val/admin/proxy"
      layout={isMobile ? "sheet" : "popover"}
      trigger={isMobile ? "icon" : "button"}
      mode={studioMode}
    >
      <a
        href={membersHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={isMobile ? `Share ${org}` : undefined}
        title={`Members of ${org} in Val Build`}
        className={
          isMobile
            ? "grid place-items-center w-8 h-8 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            : "inline-flex items-center h-7 px-2.5 rounded-md border border-border-secondary text-[0.8125rem] font-medium text-fg-primary hover:bg-bg-float-raised"
        }
      >
        {isMobile ? <UserPlus size={17} /> : "Share"}
      </a>
    </val-members>
  );
}

/** The org of an `org/name` project, or null for anything else. */
export function orgOfProject(projectName: string): string | null {
  const [org, name, ...rest] = projectName.split("/");
  return org && name && rest.length === 0 ? org : null;
}
