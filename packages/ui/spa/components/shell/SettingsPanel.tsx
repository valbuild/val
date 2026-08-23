import { ReactNode } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Checkbox } from "../designSystem/checkbox";
import { FloatingPanel, PanelSectionLabel } from "./FloatingPanel";
import { Avatar } from "./Avatar";
import { ShellBreakpoint } from "./types";

export type SettingsPanelProps = {
  breakpoint: ShellBreakpoint;
  user: { name: string; email: string; initials: string };
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  isDevMode: boolean;
  onDevModeChange: (devMode: boolean) => void;
  autoSave: boolean;
  onAutoSaveChange: (autoSave: boolean) => void;
  branch: string;
  onSignOut: () => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
};

/**
 * Account and workspace settings.
 *
 * Also where Auto save and Dev mode live on mobile, since the status bar is
 * not shown there.
 */
export function SettingsPanel({
  breakpoint,
  user,
  theme,
  onThemeChange,
  isDevMode,
  onDevModeChange,
  autoSave,
  onAutoSaveChange,
  branch,
  onSignOut,
  onClose,
  navSwitcher,
}: SettingsPanelProps) {
  return (
    <FloatingPanel
      side="left"
      width={300}
      title="Settings"
      mobileVariant="sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      subheader={navSwitcher}
    >
      <div className="pb-4">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <Avatar initials={user.initials} />
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{user.name}</div>
            <div className="text-[0.6875rem] text-fg-secondary-alt truncate">
              {user.email}
            </div>
          </div>
        </div>

        <PanelSectionLabel>Appearance</PanelSectionLabel>
        <div className="px-4 pt-1">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex p-0.5 rounded-md bg-bg-float-raised"
          >
            {(["dark", "light"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={theme === option}
                onClick={() => onThemeChange(option)}
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 h-7 rounded text-xs capitalize",
                  theme === option
                    ? "bg-bg-float text-fg-primary shadow-sm"
                    : "text-fg-secondary hover:text-fg-primary",
                )}
              >
                {option === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                {option}
              </button>
            ))}
          </div>
        </div>

        <PanelSectionLabel divided>Workspace</PanelSectionLabel>
        <div className="px-4 pt-1 space-y-2.5">
          <SettingsToggle
            label="Auto save"
            description="Write changes to the working tree as you type."
            checked={autoSave}
            onChange={onAutoSaveChange}
          />
          <SettingsToggle
            label="Dev mode"
            description="Show source paths and schema details in the editor."
            checked={isDevMode}
            onChange={onDevModeChange}
          />
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-fg-secondary">Branch</span>
            <span className="font-mono text-fg-primary">{branch}</span>
          </div>
        </div>

        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}

function SettingsToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex gap-2.5 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-0.5 w-3.5 h-3.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-xs text-fg-primary">{label}</span>
        <span className="block text-[0.6875rem] text-fg-secondary-alt">
          {description}
        </span>
      </span>
    </label>
  );
}
