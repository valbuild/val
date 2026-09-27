import type { DependencyChange } from "@valbuild/shared/internal";
import { Button } from "../designSystem/button";
import { SettingsSection, SettingsSectionDivider } from "./SettingsPanel";
import type { SiteUpdateView } from "../../publish/useSiteUpdate";

/**
 * The update section, presentational. The connected half is `ValSiteUpdate`,
 * in its own file so this one imports no provider -- see
 * `settingsPanelPresentational.test.tsx` for why that matters.
 */
export function SiteUpdateSection({
  view,
  buildsInNewTab,
  onUpdate,
  onRetry,
  onReload,
  onOpenBuilderTab,
}: {
  view: SiteUpdateView;
  /**
   * Whether the update will run in a tab of its own, because this page cannot
   * run the builder (WebKit). See `canBuildHere`.
   */
  buildsInNewTab: boolean;
  onUpdate: () => void;
  onRetry: () => void;
  onReload: () => void;
  onOpenBuilderTab: () => void;
}) {
  return (
    <>
      <SettingsSection title="Updates" description={descriptionOf(view)}>
        <SiteUpdateBody
          view={view}
          buildsInNewTab={buildsInNewTab}
          onUpdate={onUpdate}
          onRetry={onRetry}
          onReload={onReload}
          onOpenBuilderTab={onOpenBuilderTab}
        />
      </SettingsSection>
      <SettingsSectionDivider />
    </>
  );
}

function descriptionOf(view: SiteUpdateView): string {
  switch (view.status) {
    case "checking":
      return "Checking for a newer version of the software your site runs on.";
    case "current":
      return "Your site runs on the newest version.";
    case "available":
      return "A newer version of the software your site runs on is available.";
    case "unavailable":
      return view.message;
    case "check-failed":
      return "Could not check for updates.";
    case "updating":
      return "Updating your site. This takes a minute or two.";
    case "blocked":
      return "Updating your site needs a tab of its own.";
    case "updated":
      return "Your site was updated and is live.";
    case "failed":
      return view.message;
  }
}

function SiteUpdateBody({
  view,
  buildsInNewTab,
  onUpdate,
  onRetry,
  onReload,
  onOpenBuilderTab,
}: {
  view: SiteUpdateView;
  buildsInNewTab: boolean;
  onUpdate: () => void;
  onRetry: () => void;
  onReload: () => void;
  onOpenBuilderTab: () => void;
}) {
  switch (view.status) {
    case "checking":
    case "current":
    case "unavailable":
      return null;
    case "check-failed":
      return (
        <div className="flex flex-col gap-2">
          <Details text={view.message} />
          <Button size="xs" variant="outline" onClick={onRetry}>
            Check again
          </Button>
        </div>
      );
    case "available":
      return (
        <div className="flex flex-col gap-3">
          <ChangeList changes={view.changes} />
          <p className="text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
            Updating rebuilds your site on the new version and publishes it.
            Unpublished changes are kept, and are not published. If the updated
            site does not pass its check, nothing changes.
          </p>
          {buildsInNewTab && (
            <p className="text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
              A new tab opens to build the site, and closes when it is done.
            </p>
          )}
          <Button size="sm" onClick={onUpdate}>
            Update site
          </Button>
        </div>
      );
    case "blocked":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
            Your browser blocked the tab that builds the site.
          </p>
          <Button size="sm" onClick={onOpenBuilderTab}>
            Open it
          </Button>
        </div>
      );
    case "updating":
      return (
        <p className="text-xs font-medium" role="status" aria-live="polite">
          {view.step}…
        </p>
      );
    case "updated":
      return (
        <div className="flex flex-col gap-2">
          <ChangeList changes={view.changes} />
          <p className="text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
            This Studio is still the previous version. Reload to use the new
            one.
          </p>
          <Button size="sm" onClick={onReload}>
            Reload the Studio
          </Button>
        </div>
      );
    case "failed":
      return (
        <div className="flex flex-col gap-2">
          <Details text={view.details} />
          <Button size="xs" variant="outline" onClick={onRetry}>
            Check again
          </Button>
        </div>
      );
  }
}

/**
 * What moves, runtime dependencies first. A dev dependency is on the list too,
 * because the rewritten `package.json` carries it, but it is not what anyone
 * reading this is deciding on -- so it goes last.
 */
function ChangeList({ changes }: { changes: DependencyChange[] }) {
  if (changes.length === 0) {
    // Only the platform's build of the dependencies moved.
    return null;
  }
  const ordered = [
    ...changes.filter((change) => change.section === "dependencies"),
    ...changes.filter((change) => change.section !== "dependencies"),
  ];
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {ordered.map((change) => (
        <li
          key={`${change.section}:${change.name}`}
          className="flex items-baseline justify-between gap-3"
        >
          <span className="font-mono text-[0.6875rem] truncate">
            {change.name}
          </span>
          <span className="shrink-0 font-mono text-[0.6875rem] text-fg-secondary-alt">
            {change.from ?? "new"} → {change.to}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Details({ text }: { text: string }) {
  return (
    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-bg-secondary p-2 font-mono text-[0.6875rem] text-fg-secondary-alt">
      {text}
    </pre>
  );
}
