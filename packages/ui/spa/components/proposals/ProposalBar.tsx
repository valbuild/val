import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Hammer,
  Package,
  Save,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { useDismissOnOutsidePointer } from "../shell/useDismissOnOutsidePointer";
import type {
  ProposalCodeState,
  ProposalJobState,
  StudioLocation,
} from "./types";
import { Spinner } from "../designSystem/spinner";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;

/**
 * What the top bar does in a proposal. `docs/proposals.md`, Flow B.
 *
 * Save commits the proposal's changes, and its address serves them on the
 * next request; it is never a publish and never a push. Publish is the
 * proposal's way to the site -- merging it -- and saves first when there is
 * something unsaved, because only what was saved is ever published. What it
 * will publish is what Review shows: the proposal against the site.
 *
 * A save that failed says so on the button, as a failed publish does on the
 * site's.
 */
export function ProposalSaveButton({
  location,
  onSave,
  blockedBy,
  className,
}: {
  location: InProposal;
  onSave: () => void;
  /**
   * Validation errors a save would be refused for. With unsaved changes the
   * button is "Fix N" and goes to them, as the site's Publish is -- pressing
   * Save only to be told the content is invalid was the alternative.
   */
  blockedBy?: { errors: number; onShow: () => void };
  className?: string;
}) {
  const saving = location.save.state === "saving";
  const failed = location.save.state === "failed" ? location.save : null;
  const blocked =
    !saving &&
    location.unsaved > 0 &&
    blockedBy !== undefined &&
    blockedBy.errors > 0
      ? blockedBy
      : null;
  const canSave = location.unsaved > 0 && !saving;
  return (
    <button
      type="button"
      onClick={blocked !== null ? blocked.onShow : onSave}
      disabled={!canSave}
      title={
        blocked !== null
          ? `${blocked.errors} validation ${blocked.errors === 1 ? "error" : "errors"} to fix before saving. Press to see ${blocked.errors === 1 ? "it" : "them"}.`
          : failed !== null
            ? `${failed.error}. Press to try again.`
            : undefined
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
        failed !== null || blocked !== null
          ? "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover"
          : "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
        "disabled:bg-bg-disabled disabled:text-fg-disabled",
        className,
      )}
    >
      {saving ? (
        <Spinner size={14} />
      ) : failed !== null || blocked !== null ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : (
        <Save size={14} className="shrink-0" />
      )}
      <span className="truncate">
        {saving
          ? "Saving…"
          : blocked !== null
            ? `Fix ${blocked.errors > 9 ? "9+" : blocked.errors}`
            : failed !== null
              ? "Save failed"
              : "Save"}
      </span>
      {!saving &&
        failed === null &&
        blocked === null &&
        location.unsaved > 0 && (
          <span className="tabular-nums opacity-80">{location.unsaved}</span>
        )}
    </button>
  );
}

/**
 * Where the proposal's preview is, in the words a person is shown, once Save
 * updates it too (`onSaveAndBuild`). Every step that makes a preview -- the
 * packages' lockfile, the packages, the code -- is one "update", because
 * nobody editing a site needs to know there are steps.
 *
 * - `behind`: the code or the packages changed since the preview was made.
 * - `updating`: any of the steps is running.
 * - `blocked`: this browser makes the preview in a new tab, which did not
 *   open (Safari).
 * - `failed`: it could not be made. `canRetry` is false where pressing again
 *   would fail the same way -- packages that could not be installed only
 *   install once something in the code changes -- so nothing offers a retry.
 */
export type PreviewUpdate =
  | { state: "up-to-date" }
  | { state: "behind" }
  | { state: "updating" }
  | { state: "blocked" }
  | { state: "failed"; error: string; canRetry: boolean };

export function previewUpdateOf(code: ProposalCodeState | null): PreviewUpdate {
  if (code === null) return { state: "up-to-date" };
  switch (code.state) {
    case "required":
      return { state: "behind" };
    case "building":
    case "dependencies-building":
      return { state: "updating" };
    case "blocked":
      return { state: "blocked" };
    case "failed":
      return { state: "failed", error: code.error, canRetry: true };
    case "lockfile":
      return code.computing
        ? { state: "updating" }
        : code.error !== null
          ? { state: "failed", error: code.error, canRetry: true }
          : { state: "behind" };
    case "dependencies-failed":
      return {
        state: "failed",
        error: code.error ?? "The site's packages could not be installed.",
        canRetry: false,
      };
  }
}

/**
 * Whether pressing Save, with nothing unsaved, would update the preview:
 * it is behind, its last update failed in a way a retry can fix, or the tab
 * it is made in has to be opened.
 */
export function buildIsDue(code: ProposalCodeState | null): boolean {
  const update = previewUpdateOf(code);
  return (
    update.state === "behind" ||
    update.state === "blocked" ||
    (update.state === "failed" && update.canRetry)
  );
}

/**
 * Save, when it updates the preview too (`onSaveAndBuild`): ONE step where
 * there were three -- Save, Compute lockfile, Build.
 *
 * Enabled while there is something unsaved OR the preview is behind, and
 * pressing it saves what there is and then updates the preview, running
 * whatever that takes. It reads "Save" throughout; when the preview will be
 * updated too its icon is a hammer instead of the disk, and the tooltip says
 * so. While that runs it says "Updating…", and
 * when it could not, "Couldn't update" -- which pressing tries again, unless
 * trying again cannot help, when it says so instead of offering it.
 */
export function ProposalSaveAndBuildButton({
  location,
  onSaveAndBuild,
  blockedBy,
  className,
}: {
  location: InProposal;
  onSaveAndBuild: () => void;
  /** As {@link ProposalSaveButton}'s: "Fix N" while a save would be refused. */
  blockedBy?: { errors: number; onShow: () => void };
  className?: string;
}) {
  const saving = location.save.state === "saving";
  const saveFailed = location.save.state === "failed" ? location.save : null;
  const update = previewUpdateOf(location.code);
  const updating = update.state === "updating";
  const updateFailed =
    location.unsaved === 0 && update.state === "failed" ? update : null;
  const tabBlocked = location.unsaved === 0 && update.state === "blocked";
  const due = buildIsDue(location.code);
  const blocked =
    !saving &&
    location.unsaved > 0 &&
    blockedBy !== undefined &&
    blockedBy.errors > 0
      ? blockedBy
      : null;
  const busy = saving || updating;
  const canPress =
    !busy && (location.unsaved > 0 || due || saveFailed !== null);
  const error =
    saveFailed !== null || updateFailed !== null || blocked !== null;
  const changes = `${location.unsaved} ${location.unsaved === 1 ? "change" : "changes"}`;
  return (
    <button
      type="button"
      onClick={blocked !== null ? blocked.onShow : onSaveAndBuild}
      disabled={!canPress}
      title={
        blocked !== null
          ? `${blocked.errors} validation ${blocked.errors === 1 ? "error" : "errors"} to fix before saving. Press to see ${blocked.errors === 1 ? "it" : "them"}.`
          : saveFailed !== null
            ? `${saveFailed.error}. Press to try again.`
            : updating
              ? "Updating the preview with the latest changes."
              : updateFailed !== null
                ? updateFailed.canRetry
                  ? "The preview couldn't be updated. Press to try again."
                  : "The preview couldn't be updated, and trying again won't help: something in the code has to change first. The assistant can fix it in code mode."
                : tabBlocked
                  ? "This browser updates the preview in a new tab, and did not let it open. Press to open it."
                  : location.unsaved > 0 && due
                    ? `Saves ${changes}, then updates the preview.`
                    : location.unsaved > 0
                      ? `Saves ${changes} in the proposal. Nothing reaches the site.`
                      : due
                        ? "The preview is behind the latest changes. Press to update it."
                        : "Everything is saved, and the preview is up to date."
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
        error
          ? "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover"
          : "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
        // A failure that a retry cannot fix stays red: it is not "nothing to do".
        updateFailed !== null && !updateFailed.canRetry
          ? "disabled:cursor-default"
          : "disabled:bg-bg-disabled disabled:text-fg-disabled",
        busy && "disabled:cursor-progress",
        className,
      )}
    >
      {busy ? (
        <Spinner size={14} />
      ) : error ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : tabBlocked ? (
        <ExternalLink size={14} className="shrink-0" />
      ) : due ? (
        // One icon, not two: the hammer says the preview is updated too, and
        // the tooltip says it in words.
        <Hammer size={14} className="shrink-0" />
      ) : (
        <Save size={14} className="shrink-0" />
      )}
      <span className="truncate">
        {saving
          ? "Saving…"
          : updating
            ? "Updating…"
            : blocked !== null
              ? `Fix ${blocked.errors > 9 ? "9+" : blocked.errors}`
              : saveFailed !== null
                ? "Save failed"
                : updateFailed !== null
                  ? "Couldn't update"
                  : tabBlocked
                    ? "Open the tab to update"
                    : "Save"}
      </span>
      {!busy && !error && !tabBlocked && location.unsaved > 0 && (
        <span className="tabular-nums opacity-80">{location.unsaved}</span>
      )}
    </button>
  );
}

/**
 * Build, in a proposal with staged files: what makes its address show them
 * (valbuild/home `docs/hosted-publishing.md`, step 7). Shown only while there
 * is something to build -- "Build required" is the button itself -- and a
 * failed build says so on it, with the reason, and builds again when pressed.
 */
export function ProposalBuildButton({
  location,
  onBuild,
  className,
}: {
  location: InProposal;
  onBuild: () => void;
  className?: string;
}) {
  const code = location.code;
  if (code === null) return null;
  if (isDependenciesState(code)) {
    return (
      <DependenciesButton code={code} onPress={onBuild} className={className} />
    );
  }
  const building = code.state === "building";
  const blocked = code.state === "blocked";
  const failed = code.state === "failed" ? code : null;
  return (
    <button
      type="button"
      onClick={onBuild}
      disabled={building}
      title={
        failed !== null
          ? `The build failed: ${failed.error}. Press to build again.`
          : building
            ? "Building the proposal's code, so its preview shows it."
            : blocked
              ? "This browser builds the proposal in a new tab, and did not let it open. Press to open it."
              : "Code has changed in this proposal. Build it so the preview shows the change."
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium",
        failed !== null
          ? "border-transparent bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover"
          : "border-border-proposal text-fg-primary hover:bg-bg-proposal-soft",
        "disabled:text-fg-disabled",
        className,
      )}
    >
      {building ? (
        <Spinner size={14} />
      ) : failed !== null ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : blocked ? (
        <ExternalLink size={14} className="shrink-0" />
      ) : (
        <Hammer size={14} className="shrink-0" />
      )}
      <span className="truncate">
        {building
          ? "Building…"
          : failed !== null
            ? "Build failed"
            : blocked
              ? "Open the tab to build"
              : "Build required"}
      </span>
    </button>
  );
}

/**
 * What Build says while the proposal's dependencies stand in its way, in the
 * bar and in the phone's sheet alike. `busy` and `failed` cannot be pressed:
 * nothing here makes a failed build of the dependencies work -- the package
 * files do -- so it says why rather than offering the same failure again.
 */
export function describeDependencies(
  code: Extract<
    ProposalCodeState,
    {
      state: "lockfile" | "dependencies-building" | "dependencies-failed";
    }
  >,
): { label: string; detail: string; busy: boolean; failed: boolean } {
  switch (code.state) {
    case "dependencies-building":
      return {
        label: "Building dependencies…",
        detail:
          "The proposal's dependencies changed, and they are being built. Build can be pressed once they are.",
        busy: true,
        failed: false,
      };
    case "dependencies-failed":
      return {
        label: "Dependencies failed",
        detail: `The proposal's dependencies could not be built${code.error ? `: ${code.error}` : ""}. Change its package.json to build them again.`,
        busy: false,
        failed: true,
      };
    case "lockfile":
      return code.computing
        ? {
            label: "Computing lockfile…",
            detail:
              "Computing the lockfile for the proposal's dependencies. They are built from it next.",
            busy: true,
            failed: false,
          }
        : {
            label: "Compute lockfile",
            detail: `Build required: dependencies changed. Their lockfile does not match them${code.error ? ` (${code.error})` : ""}. Press to compute it, and the dependencies are built from it.`,
            busy: false,
            failed: false,
          };
  }
}

/** The dependency states of Build, which {@link describeDependencies} words. */
export function isDependenciesState(
  code: ProposalCodeState,
): code is Extract<
  ProposalCodeState,
  { state: "lockfile" | "dependencies-building" | "dependencies-failed" }
> {
  return (
    code.state === "lockfile" ||
    code.state === "dependencies-building" ||
    code.state === "dependencies-failed"
  );
}

/**
 * Build, while the proposal's dependencies stand in its way (valbuild/home
 * `docs/adept.md`, step 6): they changed and the lockfile does not match
 * them -- "Build required: dependencies changed", and the button computes
 * the lockfile -- or they are being built, or they could not be.
 */
function DependenciesButton({
  code,
  onPress,
  className,
}: {
  code: Extract<
    ProposalCodeState,
    {
      state: "lockfile" | "dependencies-building" | "dependencies-failed";
    }
  >;
  onPress: () => void;
  className?: string;
}) {
  const { label, detail: title, busy, failed } = describeDependencies(code);
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={busy || failed}
      title={title}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium",
        failed
          ? "border-transparent bg-bg-error-primary text-fg-error-primary"
          : "border-border-proposal text-fg-primary hover:bg-bg-proposal-soft",
        "disabled:cursor-default",
        busy && "disabled:text-fg-disabled",
        className,
      )}
    >
      {busy ? (
        <Spinner size={14} />
      ) : failed ? (
        <AlertTriangle size={14} className="shrink-0" />
      ) : (
        <Package size={14} className="shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Publish, in a proposal: merging it into the site. Once everything is saved
 * (and built) it is the next thing to do, so it is the primary -- the main
 * half of `ProposalActionButton` above a phone, the bottom bar's one action on
 * one -- and wears the proposal's colour rather than the site's green.
 *
 * At a published proposal's address it says so instead, and does nothing: a
 * merged proposal is finished.
 */
export function ProposalPublishButton({
  location,
  onPublish,
  className,
}: {
  location: InProposal;
  onPublish: () => void;
  className?: string;
}) {
  if (location.proposal.status === "merged") {
    return (
      <button
        type="button"
        disabled
        title={location.publishBlockedBy ?? "Published to the site"}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-proposal px-3 text-xs font-medium text-fg-proposal",
          className,
        )}
      >
        <Check size={14} className="shrink-0" />
        <span className="truncate">Published</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={location.publishBlockedBy !== null}
      title={
        location.publishBlockedBy ??
        (location.unsaved > 0
          ? "Saves the proposal, then publishes it to the site"
          : "Publishes the proposal to the site")
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
        "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
        "disabled:bg-bg-disabled disabled:text-fg-disabled",
        className,
      )}
    >
      <Upload size={14} className="shrink-0" />
      <span className="truncate">Publish</span>
    </button>
  );
}

/** What a proposal's one primary action is: whichever step comes next. */
export type ProposalNextAction = "save" | "build" | "publish";

/**
 * The step that comes next, the same rule on every screen: Save while
 * anything is unsaved (or a save is running or failed), then Build while the
 * proposal has code its preview does not show yet, then Publish. Only what
 * was saved is ever published, and a proposal is built before it goes live.
 */
export function nextProposalAction(
  location: InProposal,
  canBuild: boolean,
  /**
   * Save updates the preview too (`onSaveAndBuild`): until the preview is up
   * to date -- whatever that takes, the packages included -- the next step
   * is Save's, and there is no Build step at all.
   */
  saveBuilds = false,
): ProposalNextAction {
  if (location.unsaved > 0 || location.save.state !== "idle") return "save";
  if (saveBuilds && location.code !== null) return "save";
  if (location.code !== null && canBuild) return "build";
  return "publish";
}

type Tone = "primary" | "error" | "outline" | "muted";

const CARET_TONES: Record<Tone, string> = {
  primary:
    "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover border-l border-l-[color-mix(in_srgb,currentColor_30%,transparent)]",
  error:
    "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover border-l border-l-[color-mix(in_srgb,currentColor_30%,transparent)]",
  outline:
    "border border-border-proposal text-fg-primary hover:bg-bg-proposal-soft",
  muted:
    "border border-border-float text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
};

/**
 * Save, Build and Publish, above a phone: ONE split button where Publish is
 * on the site. The main half is the step that comes next
 * ({@link nextProposalAction}) -- Save while there is something to save, so
 * it becomes Publish once there is not -- and the caret offers every step,
 * Publish among them, so publishing never waits for the button to get there:
 * Publish saves first. Shaped like `PreviewButton` beside it.
 *
 * Only the steps: what is done with the proposal's CHANGES. What is done
 * with the proposal itself -- compare, rename, copy its link, close -- is in
 * the switcher, as it is in the phone's sheet behind the location chip.
 *
 * At a published proposal's address there is nothing left to do, and it
 * says "Published", with no menu.
 */
export function ProposalActionButton({
  location,
  onSave,
  onBuild,
  onSaveAndBuild,
  onPublish,
  saveBlockedBy,
  defaultMenuOpen = false,
}: {
  location: InProposal;
  onSave: () => void;
  /** Absent: this proposal is not built here (an upgrade, in Val Build). */
  onBuild?: () => void;
  /**
   * Save, then update the preview: given (with `onBuild`), Save is the one
   * step for everything a preview takes, the packages included -- see
   * {@link ProposalSaveAndBuildButton}.
   */
  onSaveAndBuild?: () => void;
  onPublish: () => void;
  saveBlockedBy?: { errors: number; onShow: () => void };
  defaultMenuOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultMenuOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (location.proposal.status === "merged") {
    return <ProposalPublishButton location={location} onPublish={onPublish} />;
  }
  const saveAndBuild =
    onSaveAndBuild !== undefined && onBuild !== undefined
      ? onSaveAndBuild
      : null;
  const action = nextProposalAction(
    location,
    onBuild !== undefined,
    saveAndBuild !== null,
  );
  const saving = location.save.state === "saving";
  const saveFailed = location.save.state === "failed";
  const blocked =
    location.unsaved > 0 &&
    saveBlockedBy !== undefined &&
    saveBlockedBy.errors > 0
      ? saveBlockedBy
      : null;
  const code = location.code;
  const build =
    code === null || onBuild === undefined
      ? null
      : isDependenciesState(code)
        ? describeDependencies(code)
        : {
            label:
              code.state === "building"
                ? "Building…"
                : code.state === "blocked"
                  ? "Open the tab to build"
                  : code.state === "failed"
                    ? "Build again"
                    : "Build",
            detail:
              code.state === "failed"
                ? `The build failed: ${code.error}`
                : code.state === "blocked"
                  ? "This browser builds the proposal in a new tab, and did not let it open."
                  : "Code changed in this proposal. Build it so the preview shows it.",
            busy: code.state === "building",
            failed: code.state === "failed",
          };

  const update = previewUpdateOf(code);
  const mainDisabled =
    action === "save"
      ? saving ||
        (saveAndBuild !== null && location.unsaved === 0 && !buildIsDue(code))
      : action === "build"
        ? build === null ||
          build.busy ||
          (build.failed && isDependenciesCode(code))
        : location.publishBlockedBy !== null;
  const mainTone: Tone =
    action === "save"
      ? blocked !== null ||
        saveFailed ||
        (saveAndBuild !== null &&
          location.unsaved === 0 &&
          update.state === "failed")
        ? "error"
        : "primary"
      : action === "build"
        ? build?.failed
          ? "error"
          : "outline"
        : "primary";
  // A failure nothing here can retry stays red, caret and all.
  const caretTone: Tone =
    mainDisabled && mainTone !== "error" ? "muted" : mainTone;

  const choose = (act: () => void) => () => {
    setIsOpen(false);
    act();
  };
  const publishRefusedBy =
    location.publishBlockedBy ??
    (blocked !== null
      ? "Fix the validation errors first: publishing saves the changes."
      : null);

  return (
    <div ref={containerRef} className="relative h-8 shrink-0">
      <div className="inline-flex h-full items-stretch">
        {action === "save" && saveAndBuild !== null ? (
          <ProposalSaveAndBuildButton
            location={location}
            onSaveAndBuild={saveAndBuild}
            blockedBy={saveBlockedBy}
            className="rounded-r-none"
          />
        ) : action === "save" ? (
          <ProposalSaveButton
            location={location}
            onSave={onSave}
            blockedBy={saveBlockedBy}
            className="rounded-r-none"
          />
        ) : action === "build" && onBuild !== undefined ? (
          <ProposalBuildButton
            location={location}
            onBuild={onBuild}
            className="rounded-r-none"
          />
        ) : (
          <ProposalPublishButton
            location={location}
            onPublish={onPublish}
            className="rounded-r-none"
          />
        )}
        <button
          type="button"
          aria-label="More ways to save and publish"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className={cn(
            "grid w-7 place-items-center rounded-r-md",
            CARET_TONES[caretTone],
            // Outlined halves share the border between them.
            (caretTone === "outline" || caretTone === "muted") && "-ml-px",
          )}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-full mt-1 w-64 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          {location.unsaved > 0 &&
            (blocked !== null ? (
              <MenuItem
                icon={
                  <AlertTriangle
                    size={14}
                    className="text-fg-error-on-surface"
                  />
                }
                onClick={choose(blocked.onShow)}
                detail="They have to be fixed before the proposal can be saved"
              >
                {`Fix ${blocked.errors} validation ${blocked.errors === 1 ? "error" : "errors"}`}
              </MenuItem>
            ) : (
              <MenuItem
                icon={saving ? <Spinner size={14} /> : <Save size={14} />}
                onClick={choose(onSave)}
                disabled={saving}
                detail={
                  saveFailed && location.save.state === "failed"
                    ? `${location.save.error}. Press to try again.`
                    : saveAndBuild !== null && code !== null
                      ? "Then updates the preview. Nothing reaches the site."
                      : "Keep them in the proposal. Nothing reaches the site."
                }
              >
                {saving
                  ? "Saving…"
                  : `Save ${location.unsaved} ${location.unsaved === 1 ? "change" : "changes"}`}
              </MenuItem>
            ))}
          {/*
           * With Save updating the preview, the update is offered here on
           * its own only while there is nothing to save first.
           */}
          {saveAndBuild !== null &&
            location.unsaved === 0 &&
            update.state !== "up-to-date" && (
              <MenuItem
                icon={
                  update.state === "updating" ? (
                    <Spinner size={14} />
                  ) : update.state === "failed" ? (
                    <AlertTriangle
                      size={14}
                      className="text-fg-error-on-surface"
                    />
                  ) : (
                    <Hammer size={14} />
                  )
                }
                onClick={choose(saveAndBuild)}
                disabled={!buildIsDue(code)}
                detail={
                  update.state === "updating"
                    ? "Showing the latest changes in the preview."
                    : update.state === "failed"
                      ? update.canRetry
                        ? "The preview couldn't be updated. Try again."
                        : "The preview couldn't be updated, and trying again won't help. The assistant can fix it in code mode."
                      : "Show the latest changes in the preview."
                }
              >
                {update.state === "updating"
                  ? "Updating the preview…"
                  : update.state === "failed"
                    ? update.canRetry
                      ? "Try updating the preview again"
                      : "Couldn't update the preview"
                    : "Update the preview"}
              </MenuItem>
            )}
          {build !== null && onBuild !== undefined && saveAndBuild === null && (
            <MenuItem
              icon={
                build.busy ? (
                  <Spinner size={14} />
                ) : build.failed ? (
                  <AlertTriangle
                    size={14}
                    className="text-fg-error-on-surface"
                  />
                ) : (
                  <Hammer size={14} />
                )
              }
              onClick={choose(onBuild)}
              disabled={
                build.busy || (build.failed && isDependenciesCode(code))
              }
              detail={build.detail}
            >
              {build.label}
            </MenuItem>
          )}
          <MenuItem
            icon={<Upload size={14} />}
            onClick={choose(onPublish)}
            disabled={publishRefusedBy !== null}
            detail={
              publishRefusedBy ??
              (location.unsaved > 0
                ? "Saves the changes first, then publishes the proposal"
                : "Merges the proposal into the site, as one change")
            }
          >
            Publish to the site
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function isDependenciesCode(code: ProposalCodeState | null): boolean {
  return code !== null && isDependenciesState(code);
}

/**
 * What the proposal's address is doing after a save, in a few words: being
 * made, catching up with the last save, checking that it still renders, or
 * failing at one of those. `null` when it is all done, which is most of the
 * time.
 */
export function proposalProgress(
  location: InProposal,
): { busy: boolean; label: string; detail: string } | null {
  const running = (job: ProposalJobState | null | undefined) =>
    job?.status === "pending" || job?.status === "running";
  const failure = (job: ProposalJobState | null | undefined) =>
    job?.status === "failed" ? { error: job.error } : null;
  const { setup } = location.proposal;
  if (running(setup)) {
    return {
      busy: true,
      label: "Setting up…",
      detail:
        "Making the proposal's own address. You can edit meanwhile; the preview follows when it is ready.",
    };
  }
  const setupFailed = failure(setup);
  if (setupFailed !== null) {
    return {
      busy: false,
      label: "Setup failed",
      detail: `The proposal's address could not be made${setupFailed.error ? `: ${setupFailed.error}` : "."} Your changes are kept.`,
    };
  }
  if (running(location.overlay)) {
    return {
      busy: true,
      label: "Updating the preview…",
      detail: "Bringing the proposal's address up to the last save.",
    };
  }
  const overlayFailed = failure(location.overlay);
  if (overlayFailed !== null) {
    return {
      busy: false,
      label: "Preview not updated",
      detail: `The proposal's address could not be brought up to the last save${overlayFailed.error ? `: ${overlayFailed.error}` : "."} The save itself is kept.`,
    };
  }
  if (running(location.renderCheck)) {
    return {
      busy: true,
      label: "Checking the preview…",
      detail: "Checking that the proposal's pages still render after the save.",
    };
  }
  const renderFailed = failure(location.renderCheck);
  if (renderFailed !== null) {
    return {
      busy: false,
      label: "Preview did not render",
      detail: `After the last save, the proposal's pages did not render${renderFailed.error ? `: ${renderFailed.error}` : "."} Fix what changed and save again.`,
    };
  }
  return null;
}

/** {@link proposalProgress}, beside the switcher: nothing while all is done. */
export function ProposalProgress({ location }: { location: InProposal }) {
  const progress = proposalProgress(location);
  if (progress === null) return null;
  return (
    <span
      role="status"
      title={progress.detail}
      aria-label={`${progress.label} ${progress.detail}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 px-1 text-xs",
        progress.busy ? "text-fg-secondary" : "text-fg-warning-primary",
      )}
    >
      {progress.busy ? (
        <Spinner size={12} />
      ) : (
        <AlertTriangle size={13} className="shrink-0" />
      )}
      <span className="hidden lg:inline">{progress.label}</span>
    </span>
  );
}

function MenuItem({
  icon,
  onClick,
  destructive = false,
  disabled = false,
  detail,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-float-raised disabled:hover:bg-transparent",
        destructive
          ? "text-fg-error-on-surface"
          : disabled
            ? "text-fg-disabled"
            : "text-fg-primary",
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center pt-0.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {detail !== undefined && (
          <span className="block text-[0.6875rem] text-fg-secondary-alt">
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}
