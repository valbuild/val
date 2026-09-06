import type { SourcePath } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useHistoryParams } from "../components/ValRouter";
import { Button } from "../components/designSystem/button";
import { enterRestore, exitRestore, pickRestoreSource } from "./historyParams";
import { restorability } from "./HistoryPane";
import { planRevertAll } from "./revertAll";
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
}: {
  patchSet: HistoricalPatchSet | undefined;
  path: SourcePath | null;
}) {
  const { history, setHistory } = useHistoryParams();
  const { canRestore, reason } = restorability(patchSet);
  const [reverting, setReverting] = useState<string | null>(null);
  const { addModuleFilePatch } = useAddPatch(path ?? ("" as SourcePath));

  if (!patchSet) {
    return null;
  }
  const inRestoreMode = history.restore.mode !== "off";

  const revertEverything = () => {
    const plan = planRevertAll(patchSet);
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
        <Button
          variant="outline"
          size="sm"
          disabled={!canRestore}
          onClick={revertEverything}
        >
          Put everything back
        </Button>
      </div>
      {inRestoreMode && (
        <p className="text-xs text-fg-secondary">
          {history.restore.mode === "picking-source"
            ? "Pick a field here to restore, then pick where it goes on the left."
            : "Now pick where it goes on the left. Fields that cannot hold it are marked."}
        </p>
      )}
      {/* Nothing is written until Publish — said here rather than discovered. */}
      {reverting && <p className="text-xs text-fg-secondary">{reverting}</p>}
      {reason && (
        <p className="max-w-prose text-xs text-fg-tertiary">{reason}</p>
      )}
      {inRestoreMode && path && history.restore.mode === "picking-source" && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setHistory(pickRestoreSource(history, path))}
        >
          Restore this whole module
        </Button>
      )}
    </div>
  );
}
