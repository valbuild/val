import { Braces, CircleUser, FileText, Image, Settings } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { ShellDestination, ShellPanel } from "./types";
import { ValLogo } from "./ValLogo";
import { Avatar } from "../Avatar";
import { AccountErrorDot } from "./AccountError";

export type RailItem = {
  panel: ShellDestination;
  label: string;
  icon: typeof FileText;
};

/**
 * The destinations, in rail order.
 *
 * Settings is last, and on desktop it is drawn at the FOOT of the rail rather
 * than in the strip at the top — directly above the account button, which is
 * where a project's own configuration belongs: near the other thing that is
 * about the setup rather than about a piece of content. The account button is
 * below it, and is not a destination at all (it is per-person: the theme, auto
 * save, signing out).
 *
 * It is still a member of this list because mobile has no rail — the switcher
 * at the top of every sheet stands in for it, and Settings has to be reachable
 * there too. `LeftRail` is what splits the list; see `FOOT_PANEL`.
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
  { panel: "settings", label: "Settings", icon: Settings },
];

/**
 * The destination drawn at the foot of the rail instead of in the top strip.
 *
 * One, and named here so `LeftRail` and its tests agree on which.
 */
const FOOT_PANEL: ShellDestination = "settings";

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
  user?: { name: string; avatarUrl?: string };
  /** Number of pending draft changes, shown as a dot on the account button. */
  hasDraftChanges?: boolean;
  /**
   * Set when the account could not be loaded, and the studio has stopped trying.
   *
   * Marks the button rather than announcing itself, because the panel it opens
   * is where the explanation and the retry are. Note that this is exactly the
   * case where `user` is absent — so the mark has to appear on the cog as well.
   */
  accountError?: { message: string };
  /** Blinks the mark, as a terminal caret does while it waits. */
  isLoading?: boolean;
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
  accountError,
  isLoading,
}: LeftRailProps) {
  const items = visibleRailItems(destinations);
  const topItems = items.filter((item) => item.panel !== FOOT_PANEL);
  const footItem = items.find((item) => item.panel === FOOT_PANEL);
  return (
    <nav
      aria-label="Main"
      className="absolute left-3 top-3 bottom-3 z-full w-12 flex flex-col items-center py-2 gap-1 rounded-lg bg-bg-float border border-border-float shadow-sm"
    >
      <div className="grid place-items-center w-8 h-8 mb-1 shrink-0 text-fg-primary">
        <ValLogo className="h-6" blinking={isLoading} />
      </div>
      {topItems.map(({ panel, label, icon: Icon }) => (
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
       * The foot of the rail: the account, or a faceless one where there is no
       * account.
       *
       * The panel it opens is not only about the person signed in — the theme,
       * dev mode, auto save and the branch all live there — so hiding the
       * button on a local checkout hid the whole panel with it, and there was
       * no way to reach it at all.
       *
       * A person outline rather than a cog: the cog is Settings now, and the
       * same icon twice in one strip reads as one control drawn twice.
       */}
      {/*
       * Settings, immediately above the account: the project's own setup next
       * to the person's own. Absent for a project with no `s.settings()`
       * module — see `availableDestinations`.
       */}
      <div className="mt-auto shrink-0 flex flex-col items-center gap-1">
        {footItem && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={footItem.label}
                aria-current={openPanel === footItem.panel ? "true" : undefined}
                onClick={() => onSelect(footItem.panel)}
                className={cn(
                  "grid place-items-center w-8 h-8 rounded-md shrink-0 transition-colors",
                  openPanel === footItem.panel
                    ? "bg-bg-float-raised text-fg-primary"
                    : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
                )}
              >
                <footItem.icon size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{footItem.label}</TooltipContent>
          </Tooltip>
        )}
        {user ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Account: ${user.name}`}
                aria-current={openPanel === "account" ? "true" : undefined}
                onClick={() => onSelect("account")}
                className="relative grid place-items-center w-8 h-8 rounded-full"
              >
                <Avatar name={user.name} imageUrl={user.avatarUrl} size="sm" />
                {accountError && <AccountErrorDot />}
                {hasDraftChanges && (
                  <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-fg-secondary ring-2 ring-bg-float" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {accountError ? accountError.message : user.name}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Account"
                aria-current={openPanel === "account" ? "true" : undefined}
                onClick={() => onSelect("account")}
                className={cn(
                  "relative grid place-items-center w-8 h-8 rounded-md transition-colors",
                  openPanel === "account"
                    ? "bg-bg-float-raised text-fg-primary"
                    : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
                )}
              >
                <CircleUser size={17} />
                {accountError && <AccountErrorDot />}
                {hasDraftChanges && (
                  <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-fg-secondary ring-2 ring-bg-float" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {accountError ? accountError.message : "Account"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </nav>
  );
}
