import { ReactNode } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Checkbox } from "../designSystem/checkbox";
import { FloatingPanel, PanelSectionLabel } from "./FloatingPanel";
import { Avatar } from "./Avatar";
import { AccountErrorNotice, ShellAccountError } from "./AccountError";
import { DeploymentRows } from "./Deployments";
import { ShellBreakpoint, ShellDeployment } from "./types";

export type SettingsPanelProps = {
  breakpoint: ShellBreakpoint;
  user?: { name: string; email?: string; initials: string };
  /**
   * Why there is no account, when there should be one.
   *
   * Shown where the account would have been, because that is the question it
   * answers — and with the retry, since everything that produces this is
   * something an editor may have just fixed elsewhere.
   */
  accountError?: ShellAccountError;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  isDevMode: boolean;
  onDevModeChange: (devMode: boolean) => void;
  /** How Val is running. Auto save is a dev-server setting; see `StatusBar`. */
  mode?: "fs" | "http" | "unknown";
  autoSave: boolean;
  onAutoSaveChange: (autoSave: boolean) => void;
  branch?: string;
  /** Publishes in flight or recently finished. Absent when there is no feed. */
  deployments?: ShellDeployment[];
  onDismissDeployment?: (commitSha: string) => void;
  /**
   * Ends the session. Absent where there is not one.
   *
   * Optional rather than a no-op default: running against the working copy on
   * disk there is nothing to sign out of, and the button was still rendered —
   * wired to a function that did nothing.
   */
  onSignOut?: () => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
};

/**
 * Account and workspace settings.
 *
 * Also where Auto save, Dev mode and the deployment feed live on mobile,
 * since the status bar is not shown there.
 */
export function SettingsPanel({
  breakpoint,
  user,
  accountError,
  theme,
  onThemeChange,
  isDevMode,
  onDevModeChange,
  mode,
  autoSave,
  onAutoSaveChange,
  branch,
  deployments,
  onDismissDeployment,
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
        {accountError && <AccountErrorNotice error={accountError} />}
        {user && (
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Avatar initials={user.initials} />
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{user.name}</div>
              {user.email && (
                <div className="text-[0.6875rem] text-fg-secondary-alt truncate">
                  {user.email}
                </div>
              )}
            </div>
          </div>
        )}

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
          {/* `fs` only, for the reason given in `StatusBar`. */}
          {mode === "fs" && (
            <SettingsToggle
              label="Auto save"
              description="Write changes to the working tree on a pause in typing."
              checked={autoSave}
              onChange={onAutoSaveChange}
            />
          )}
          <SettingsToggle
            label="Dev mode"
            description="Show source paths and schema details in the editor."
            checked={isDevMode}
            onChange={onDevModeChange}
          />
          {branch && (
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-fg-secondary">Branch</span>
              <span className="font-mono text-fg-primary">{branch}</span>
            </div>
          )}
        </div>

        {deployments !== undefined && (
          <>
            <PanelSectionLabel divided>Deployments</PanelSectionLabel>
            <div className="pt-1">
              <DeploymentRows
                deployments={deployments}
                onDismiss={onDismissDeployment ?? (() => undefined)}
              />
            </div>
          </>
        )}

        {onSignOut && (
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
        )}
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
