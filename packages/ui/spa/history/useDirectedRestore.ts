import type { Json, SerializedSchema, SourcePath } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useCallback, useMemo, useState } from "react";
import { useHistoryParams } from "../components/ValRouter";
import {
  clearRestoreTarget,
  pickRestoreSource,
  pickRestoreTarget,
} from "./historyParams";
import type { RestoreMode } from "./RestoreModeContext";
import { useStageRestore, type StageState } from "./useStageRestore";

export type DirectedRestore = {
  /** For the left pane: fields answer whether they can hold the picked value. */
  nowMode: RestoreMode | null;
  /** For the right pane: every field is offered. */
  commitMode: RestoreMode | null;
  from: { path: SourcePath; value: Json; schema: SerializedSchema } | null;
  toPath: SourcePath | null;
  stage: StageState;
  confirm: () => void;
  clearTarget: () => void;
};

/**
 * The restore a person is aiming, across both panes.
 *
 * The URL holds which STAGE we are at, because every stage of a restore has to
 * be a link. The picked VALUE is held here beside it: a path alone would mean
 * re-reading the commit to answer every "can this field hold it?", and those
 * questions are asked once per field per render.
 *
 * A reload therefore lands on the right stage with nothing picked, which is the
 * honest outcome — the link says what was being done, and the value is picked
 * again from the pane that is right there.
 */
export function useDirectedRestore(
  patchSet: HistoricalPatchSet | undefined,
): DirectedRestore {
  const { history, setHistory } = useHistoryParams();
  const [picked, setPicked] = useState<{
    path: SourcePath;
    value: Json;
    schema: SerializedSchema;
  } | null>(null);

  const active = history.restore.mode !== "off";
  const toPath =
    history.restore.mode === "confirming" ? history.restore.to : null;

  const { state, stage } = useStageRestore(toPath, "/api/val");

  const onPickSource = useCallback(
    (path: SourcePath, value: Json, schema: SerializedSchema) => {
      setPicked({ path, value, schema });
      // Picking again drops any destination: it was chosen against the OLD
      // value, and carrying it would keep a decision nobody re-checked.
      setHistory(pickRestoreSource(history, path));
    },
    [history, setHistory],
  );

  const onPickTarget = useCallback(
    (path: SourcePath) => {
      setHistory(pickRestoreTarget(history, path));
    },
    [history, setHistory],
  );

  const modes = useMemo<{
    nowMode: RestoreMode | null;
    commitMode: RestoreMode | null;
  }>(() => {
    if (!active) {
      return { nowMode: null, commitMode: null };
    }
    const shared = { from: picked, toPath, onPickSource, onPickTarget };
    return {
      nowMode: { side: "now", ...shared },
      commitMode: { side: "commit", ...shared },
    };
  }, [active, picked, toPath, onPickSource, onPickTarget]);

  const confirm = useCallback(() => {
    if (!picked || !toPath || !patchSet) {
      return;
    }
    void stage({
      commitSha: patchSet.commit.commitSha,
      // The store's `Json` (readonly arrays) and the patch layer's `JSONValue`
      // (mutable ones) describe the same data; a round trip is what a patch
      // does to it anyway, and is honest where an assertion would not be.
      value: JSON.parse(JSON.stringify(picked.value)),
      schema: picked.schema,
    });
  }, [picked, toPath, patchSet, stage]);

  const clearTarget = useCallback(() => {
    setHistory(clearRestoreTarget(history));
  }, [history, setHistory]);

  return {
    ...modes,
    from: picked,
    toPath,
    stage: state,
    confirm,
    clearTarget,
  };
}
