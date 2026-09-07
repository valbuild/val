import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useHistoryParams } from "../components/ValRouter";
import { Button } from "../components/designSystem/button";
import { enterRestore, exitRestore } from "./historyParams";
import type { DirectedRestore } from "./useDirectedRestore";
import { restorability } from "./HistoryPane";
import { containsJsonValues, planRevertAll } from "./revertAll";
import { useAddPatch } from "../components/ValFieldProvider";
import { useState } from "react";

/**
 * The controls at the top of the history pane.
 *
 * Three things, in the order people reach for them: restore ONE thing (the
 * common case, and the one the whole directed design is for), put EVERYTHING
 * back (the "that publish was a mistake" case), and leave.
 *
 * When a commit cannot be restored from, the controls are disabled with the
 * reason beside them rather than hidden. A control that vanishes leaves someone
 * looking for it; a disabled one that explains itself answers the question they
 * were about to ask.
 */
export function RestoreControls({
  patchSet,
  path,
  restore,
}: {
  patchSet: HistoricalPatchSet | undefined;
  path: SourcePath | null;
  restore: DirectedRestore;
}) {
  const { history, setHistory } = useHistoryParams();
  const { canRestore, reason } = restorability(patchSet);
  const [reverting, setReverting] = useState<string | null>(null);
  const { addModuleFilePatch } = useAddPatch(path ?? ("" as SourcePath));

  if (!patchSet) {
    return null;
  }
  const inRestoreMode = history.restore.mode !== "off";
  const moduleFilePath =
    path === null
      ? null
      : (Internal.splitModuleFilePathAndModulePath(path)[0] as ModuleFilePath);
  /*
   * The module on screen, if this commit recorded it.
   *
   * `null` on the modules-changed list (no module chosen) and on a module the
   * commit did not change — the pane can show that one, because it asks how it
   * looked as of the commit, but this commit has nothing of its own to restore
   * from. Both cases matter below: they are what the module button is offered
   * for and what "Put everything back" has to be honest about.
   */
  const moduleHere =
    moduleFilePath !== null ? patchSet.modules[moduleFilePath] : undefined;
  /*
   * Whether this module can be put back WHOLE.
   *
   * The `.jsonValues()` exclusion is the same one `planRevertAll` makes, and
   * for the same reason: a jsonValues record's entries are not in the module's
   * Source. The Source holds `{ _type: "json" }` markers and the content lives
   * in each entry's `*.val.json`, so a root `replace` with the recorded Source
   * writes those markers into the `.val.ts` over the `c.json(() => import(…))`
   * calls — and nothing downstream catches it, because `classifyJsonValuesOp`
   * walks the op path to find a jsonValues record and an empty path never gets
   * there. Restoring one FIELD of such a module is fine; it is the ROOT op that
   * is not, so the exclusion belongs on this button and not on the chrome.
   */
  const restorableHere =
    moduleHere !== undefined &&
    moduleHere.schema !== null &&
    moduleHere.source !== null &&
    !containsJsonValues(moduleHere.schema);
  /*
   * What "Put everything back" would actually stage, asked of the plan itself.
   *
   * Counting the commit's modules here instead would give a number that drifts
   * from the button the moment the plan excludes one — which it does, for the
   * same jsonValues reason — and a scope note that overstates the scope is
   * worse than none.
   */
  const revertPlan = planRevertAll(patchSet);
  const revertCount = revertPlan.modules.length;
  const revertTouchesThisModule =
    moduleFilePath !== null &&
    revertPlan.modules.some((entry) => entry.moduleFilePath === moduleFilePath);

  const restoreWholeModule = () => {
    if (
      moduleFilePath === null ||
      moduleHere === undefined ||
      moduleHere.schema === null ||
      moduleHere.source === null ||
      !restorableHere
    ) {
      return;
    }
    restore.restoreWholeModule(
      moduleFilePath,
      moduleHere.source,
      moduleHere.schema,
    );
  };

  const revertEverything = () => {
    const plan = revertPlan;
    for (const { moduleFilePath, patch } of plan.modules) {
      addModuleFilePatch(moduleFilePath, patch, "object");
    }
    setReverting(
      plan.blocked.length === 0
        ? `Staged ${plan.modules.length} module${plan.modules.length === 1 ? "" : "s"}. Review and publish when you are ready.`
        : `Staged ${plan.modules.length}. ${plan.blocked.length} could not be put back: ${plan.blocked
            .map((entry) => entry.moduleFilePath)
            .join(", ")}`,
    );
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border-primary p-3">
      <div className="flex flex-wrap items-center gap-2">
        {inRestoreMode ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistory(exitRestore(history))}
          >
            Done restoring
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!canRestore}
            onClick={() => setHistory(enterRestore(history))}
          >
            Restore from here
          </Button>
        )}
        {/*
         * One module, from a commit that changed several.
         *
         * Only in restore mode and only before a value is picked: it is a
         * source pick like any other, and the module root is the one value the
         * field chrome cannot offer because the root is not a `Field`.
         */}
        {inRestoreMode && !restore.from && restorableHere && (
          <Button variant="outline" size="sm" onClick={restoreWholeModule}>
            Restore this whole module
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!canRestore}
          onClick={revertEverything}
        >
          Put everything back
        </Button>
      </div>
      {/*
       * What "Put everything back" covers, said before the click.
       *
       * These controls sit above whatever module the editor navigated to, and
       * that is often not a module this commit changed — the pane can still
       * show it, because it asks how the module looked AS OF the commit. The
       * button then reverts a set of modules that are not on screen, which it
       * used to do without saying so.
       */}
      {canRestore && !revertTouchesThisModule && (
        <p className="text-xs text-fg-tertiary">
          {moduleFilePath === null
            ? `“Put everything back” covers the ${revertCount} module${revertCount === 1 ? "" : "s"} this commit changed.`
            : `“Put everything back” will not touch ${moduleFilePath} — it covers the ${revertCount} module${revertCount === 1 ? "" : "s"} this commit changed and can put back.`}
        </p>
      )}
      {inRestoreMode && (
        <p className="text-xs text-fg-secondary">
          {!restore.from
            ? "Pick a field here to restore, then pick where it goes on the left."
            : !restore.toPath
              ? "Now pick where it goes on the left. Fields that cannot hold it are marked."
              : "Nothing is written until you stage it, and nothing is published until you publish."}
        </p>
      )}
      {/* The confirm step. Only reachable once BOTH ends are picked, which is
          the whole point of directing a restore rather than computing one. */}
      {restore.from && restore.toPath && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={restore.stage.status === "staging"}
            onClick={restore.confirm}
          >
            {restore.stage.status === "staging"
              ? "Staging…"
              : "Stage this restore"}
          </Button>
          {/*
           * Not offered for a whole-module restore: its destination is the
           * module it came from, and "somewhere else" would mean writing a
           * module's value into a field.
           */}
          {Internal.splitModuleFilePathAndModulePath(restore.from.path)[1] !==
            "" && (
            <Button variant="ghost" size="sm" onClick={restore.clearTarget}>
              Pick a different place
            </Button>
          )}
        </div>
      )}
      {restore.stage.status === "staged" && (
        <p className="text-xs text-fg-secondary">
          Staged. It is in your pending changes, to review and publish with
          everything else.
        </p>
      )}
      {restore.stage.status === "error" && (
        <p className="text-xs text-fg-error-primary">{restore.stage.message}</p>
      )}
      {/* Nothing is written until Publish — said here rather than discovered. */}
      {reverting && <p className="text-xs text-fg-secondary">{reverting}</p>}
      {reason && (
        <p className="max-w-prose text-xs text-fg-tertiary">{reason}</p>
      )}
    </div>
  );
}
