import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { Internal } from "@valbuild/core";
import { useMemo } from "react";
import { Module } from "../components/Module";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { unavailableModules, useCommitSystem } from "./useCommitSystem";
import { useModuleAtCommit } from "./useModuleAtCommit";
import { cn } from "../components/designSystem/cn";
import { PendingWriteHoldProvider } from "../components/PendingWriteHold";

/**
 * One module, as a commit left it, rendered by the Studio's own components.
 *
 * `Module` is the same component the editor column uses. It reads its schema
 * and its source through `useValSystem()`, so the provider around it is the
 * entire difference between "now" and "then" — no field, no preview and no
 * error renderer had to learn that history exists.
 *
 * Readonly is not passed down as a prop here because it does not have to be:
 * this system cannot write. It has no `savePatches`, so an edit made in it
 * would go nowhere, and the pane is presented as the past rather than as a form.
 */
export function HistoryPane({
  patchSet,
  path,
  loading,
  error,
  restoreSlot,
  wrapModule,
}: {
  patchSet: HistoricalPatchSet | undefined;
  /** The path to show. Under lock this is the editor's own path. */
  path: SourcePath | null;
  loading: boolean;
  error: string | null;
  /** The restore controls, when this commit can be restored from. */
  restoreSlot?: React.ReactNode;
  /**
   * Wrap the rendered module — how restore mode reaches this pane's fields.
   *
   * A render prop rather than the pane knowing about restore, so the pane keeps
   * one job: showing a module as a commit left it.
   */
  wrapModule?: (module: React.ReactNode) => React.ReactNode;
}) {
  const unavailable = useMemo(() => unavailableModules(patchSet), [patchSet]);
  const moduleFilePath = path
    ? (Internal.splitModuleFilePathAndModulePath(path)[0] as ModuleFilePath)
    : null;
  /*
   * A module the commit did not change, fetched as of that commit.
   *
   * Fetched HERE, above every early return, so the pane builds one system
   * rather than one per module navigated to — see `useCommitSystem`'s second
   * argument. `useModuleAtCommit` skips its own request when the commit already
   * carries the module, which is what makes calling it unconditionally free.
   */
  const outsideCommit =
    patchSet !== undefined &&
    moduleFilePath !== null &&
    !(moduleFilePath in patchSet.modules);
  const outsideState = useModuleAtCommit(
    patchSet?.commit.commitSha ?? null,
    moduleFilePath,
    !outsideCommit,
  );
  const outside = useMemo(
    () =>
      outsideState?.status === "success" && outsideState.module
        ? {
            moduleFilePath: moduleFilePath as ModuleFilePath,
            module: outsideState.module,
          }
        : null,
    [outsideState, moduleFilePath],
  );
  const system = useCommitSystem(patchSet, outside);

  if (error) {
    return <PaneNote title="This commit cannot be opened">{error}</PaneNote>;
  }
  if (loading || !patchSet || !system) {
    return <PaneNote title="Loading this commit…">{null}</PaneNote>;
  }

  if (moduleFilePath === null) {
    return <ChangedModules patchSet={patchSet} unavailable={unavailable} />;
  }

  const unavailableHere = unavailable.find(
    (entry) => entry.moduleFilePath === moduleFilePath,
  );
  if (unavailableHere) {
    return <PaneNote title="Not shown here">{unavailableHere.reason}</PaneNote>;
  }

  if (!(moduleFilePath in patchSet.modules)) {
    /*
     * The commit did not change this module, which does NOT mean it looked
     * like it does now — it may have changed in a later commit. So the pane
     * asks how it looked at that point rather than guessing or refusing.
     */
    if (!outsideState || outsideState.status === "loading") {
      return <PaneNote title="Loading this module…">{null}</PaneNote>;
    }
    if (outsideState.status === "error") {
      return <PaneNote title="Not shown here">{outsideState.message}</PaneNote>;
    }
    if (outsideState.module === null) {
      return (
        <PaneNote title="Not recorded at this point">
          History has no record of this module at or before this commit — it was
          last edited before Val started recording, or has never been edited.
        </PaneNote>
      );
    }
    if (outsideState.module.schema === null) {
      return (
        <PaneNote title="Not shown here">
          This module was saved with a different version of Val, so it cannot be
          shown here. Nothing is lost.
        </PaneNote>
      );
    }
    /*
     * Falls through to the ordinary render below: the module is in `system`
     * already, laid on top of the seed by `useCommitSystem`. `restoreSlot` is
     * told this is a module the commit did not change, so "Put everything
     * back" can say what it would actually touch.
     */
  }

  return (
    <>
      {restoreSlot}
      <ValSystemProvider system={system}>
        {/*
         * Held, permanently: the past is not editable.
         *
         * The system behind this pane cannot write anyway — it has no
         * `savePatches` — but that only means an edit would go nowhere. This
         * is what makes the fields SAY so, and it is what stops a `literal`
         * rendering its "not editable" error in a pane where nothing was
         * going to be edited.
         */}
        <PendingWriteHoldProvider held>
          {(wrapModule ?? ((node: React.ReactNode) => node))(
            <Module path={path as SourcePath} showModuleGalleryChild={null} />,
          )}
        </PendingWriteHoldProvider>
      </ValSystemProvider>
    </>
  );
}

/**
 * Whether a commit can be restored from at all, and what to say if not.
 *
 * Not an error, and worded so it does not read like one: a commit made before
 * history was recorded, or one made outside Val, simply has nothing stored to
 * restore FROM. The control is disabled with the reason beside it, because a
 * disabled button with no explanation is worse than no button.
 */
export function restorability(patchSet: HistoricalPatchSet | undefined): {
  canRestore: boolean;
  reason: string | null;
} {
  if (!patchSet) {
    return { canRestore: false, reason: null };
  }
  const restorable = Object.values(patchSet.modules).some(
    (module) => module.schema !== null && module.source !== null,
  );
  if (restorable) {
    return { canRestore: true, reason: null };
  }
  if (!patchSet.commit.hasArchive) {
    return {
      canRestore: false,
      reason:
        "This commit was made before Val started recording history, so there is nothing here to restore from. Everything since then can be restored.",
    };
  }
  return {
    canRestore: false,
    reason:
      "Nothing in this commit can be restored into the project as it is now.",
  };
}

/** What the commit changed, when no particular module is in view. */
function ChangedModules({
  patchSet,
  unavailable,
}: {
  patchSet: HistoricalPatchSet;
  unavailable: { moduleFilePath: ModuleFilePath; reason: string }[];
}) {
  const paths = Object.keys(patchSet.modules) as ModuleFilePath[];
  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold text-fg-primary">
        {paths.length === 1
          ? "1 module changed"
          : `${paths.length} modules changed`}
      </h2>
      <p className="text-xs text-fg-secondary">
        Open one on the left and this side follows.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {paths.map((moduleFilePath) => {
          const blocked = unavailable.find(
            (entry) => entry.moduleFilePath === moduleFilePath,
          );
          return (
            <li
              key={moduleFilePath}
              className={cn(
                "rounded border border-border-primary px-3 py-2 font-mono text-xs",
                blocked ? "text-fg-tertiary" : "text-fg-primary",
              )}
            >
              {moduleFilePath}
              {blocked && (
                <span className="mt-1 block font-sans text-[11px] text-fg-tertiary">
                  {blocked.reason}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PaneNote({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 p-6">
      <span className="text-sm font-semibold text-fg-primary">{title}</span>
      {children && (
        <p className="max-w-prose text-sm text-fg-secondary">{children}</p>
      )}
    </div>
  );
}
