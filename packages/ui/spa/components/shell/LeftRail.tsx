import { Braces, FileText, Image, Settings } from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { ShellPanel } from "./types";
import { ValLogo } from "./ValLogo";
import { Avatar } from "./Avatar";

export type RailItem = {
  panel: Extract<ShellPanel, "pages" | "media" | "data" | "settings">;
  label: string;
  icon: typeof FileText;
};

/**
 * External pages are not a top-level destination: they live at the bottom of
 * the Pages panel, because that is where someone looks for "the page that
 * links to Instagram".
 */
export const RAIL_ITEMS: RailItem[] = [
  { panel: "pages", label: "Pages", icon: FileText },
  { panel: "media", label: "Media", icon: Image },
  { panel: "data", label: "Data", icon: Braces },
  { panel: "settings", label: "Settings", icon: Settings },
];

export type LeftRailProps = {
  openPanel: ShellPanel | null;
  onSelect: (panel: ShellPanel) => void;
  user: { initials: string; name: string };
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
  user,
  hasDraftChanges,
}: LeftRailProps) {
  return (
    <nav
      aria-label="Main"
      className="absolute left-3 top-3 bottom-3 z-full w-12 flex flex-col items-center py-2 gap-1 rounded-lg bg-bg-float border border-border-float shadow-sm"
    >
      <div className="grid place-items-center w-8 h-8 mb-1 shrink-0 text-fg-primary">
        <ValLogo className="h-6" />
      </div>
      {RAIL_ITEMS.map(({ panel, label, icon: Icon }) => (
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
      <div className="mt-auto shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Account: ${user.name}`}
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
      </div>
    </nav>
  );
}
