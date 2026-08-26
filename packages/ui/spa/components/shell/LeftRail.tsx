import { Braces, FileText, Image, Settings } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { ShellDestination, ShellPanel } from "./types";
import { ValLogo } from "./ValLogo";
import { Avatar } from "./Avatar";

export type RailItem = {
  panel: ShellDestination;
  label: string;
  icon: typeof FileText;
};

/**
 * The content destinations, and only those.
 *
 * Settings is not one of them: the account button at the foot of the rail
 * opens the same panel, and two controls that do the same thing in one strip
 * of four icons is one too many. Where there is no account — running against
 * the working copy on disk, where there is no session — a cog takes its place
 * at the foot of the rail rather than being added here.
 *
 * External pages are not a top-level destination either — they live at the
 * bottom of the Pages panel, because that is where someone looks for "the
 * page that links to Instagram".
 *
 * The full set. Which of them a given project actually offers is `destinations`
 * — see `visibleRailItems`.
 */
export const RAIL_ITEMS: RailItem[] = [
  { panel: "pages", label: "Pages", icon: FileText },
  { panel: "media", label: "Media", icon: Image },
  { panel: "data", label: "Data", icon: Braces },
];

/**
 * The rail items a project offers, in rail order.
 *
 * Undefined means all of them, which is what Storybook and the tests want: a
 * component that hides two thirds of itself unless told otherwise is a
 * component nobody can look at.
 */
export function visibleRailItems(
  destinations?: readonly ShellDestination[],
): RailItem[] {
  if (destinations === undefined) return RAIL_ITEMS;
  return RAIL_ITEMS.filter((item) => destinations.includes(item.panel));
}

export type LeftRailProps = {
  openPanel: ShellPanel | null;
  onSelect: (panel: ShellPanel) => void;
  /**
   * The destinations this project has content for. All of them when absent.
   *
   * A project with no `s.router` has nothing to put under Pages, and an icon
   * that opens an empty panel is worse than no icon: it reads as something
   * broken rather than as something the project does not use.
   */
  destinations?: readonly ShellDestination[];
  user?: { initials: string; name: string };
  /** Number of pending draft changes, shown as a dot on the account button. */
  hasDraftChanges?: boolean;
};

/**
 * The floating left rail: icons only, 48px wide, hovering over the canvas.
 *
 * Desktop only — below 1200px the same destinations are reached from the top
 * bar's menu button.
 */
export function LeftRail({
  openPanel,
  onSelect,
  destinations,
  user,
  hasDraftChanges,
}: LeftRailProps) {
  const items = visibleRailItems(destinations);
  return (
    <nav
      aria-label="Main"
      className="absolute left-3 top-3 bottom-3 z-full w-12 flex flex-col items-center py-2 gap-1 rounded-lg bg-bg-float border border-border-float shadow-sm"
    >
      <div className="grid place-items-center w-8 h-8 mb-1 shrink-0 text-fg-primary">
        <ValLogo className="h-6" />
      </div>
      {items.map(({ panel, label, icon: Icon }) => (
        <Tooltip key={panel}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-current={openPanel === panel ? "true" : undefined}
              onClick={() => onSelect(panel)}
              className={cn(
                "grid place-items-center w-8 h-8 rounded-md shrink-0 transition-colors",
                openPanel === panel
                  ? "bg-bg-float-raised text-fg-primary"
                  : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
              )}
            >
              <Icon size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
      {/*
       * The foot of the rail: the account, or a cog where there is no account.
       *
       * Settings is not only about the person signed in — the theme, dev mode,
       * auto save and the branch all live there — so hiding the account button
       * on a local checkout hid the whole panel with it, and there was no way
       * to reach it at all.
       */}
      <div className="mt-auto shrink-0">
        {user ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Account: ${user.name}`}
                aria-current={openPanel === "settings" ? "true" : undefined}
                onClick={() => onSelect("settings")}
                className="relative grid place-items-center w-8 h-8 rounded-full"
              >
                <Avatar initials={user.initials} size="sm" />
                {hasDraftChanges && (
                  <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-fg-secondary ring-2 ring-bg-float" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{user.name}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                aria-current={openPanel === "settings" ? "true" : undefined}
                onClick={() => onSelect("settings")}
                className={cn(
                  "relative grid place-items-center w-8 h-8 rounded-md transition-colors",
                  openPanel === "settings"
                    ? "bg-bg-float-raised text-fg-primary"
                    : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
                )}
              >
                <Settings size={17} />
                {hasDraftChanges && (
                  <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-fg-secondary ring-2 ring-bg-float" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        )}
      </div>
    </nav>
  );
}
