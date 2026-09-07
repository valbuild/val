import type {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHistoryParams } from "../components/ValRouter";
import {
  clearRestoreTarget,
  enterRestore,
  pickRestoreSource,
  pickRestoreTarget,
} from "./historyParams";
import type { RestoreMode } from "./RestoreModeContext";
import { useStageRestore, type StageState } from "./useStageRestore";
import { useSchemaAtPath } from "../components/ValFieldProvider";
import {
  explainStructuralErrors,
  structuralErrorsOfRestore,
} from "./restoreValidity";

export type DirectedRestore = {
  /** For the left pane: fields answer whether they can hold the picked value. */
  nowMode: RestoreMode | null;
  /** For the right pane: every field is offered. */
  commitMode: RestoreMode | null;
  from: { path: SourcePath; value: Json; schema: SerializedSchema } | null;
  toPath: SourcePath | null;
  /**
   * Aim a restore at a whole module, both ends at once.
   *
   * The module root is not a `Field`, so the chrome that offers every other
   * value never reaches it — and without this there is no way to put ONE module
   * back from a commit that changed several: only "Put everything back", which
   * is a much larger thing to be pushed into.
   *
   * Both ends together because there is only one end to choose. A module's old
   * value goes back into THAT module; asking someone to then pick a
   * destination would be asking a question with one answer, and would let them
   * give the wrong one — a whole module's value written into a field.
   */
  restoreWholeModule: (
    moduleFilePath: ModuleFilePath,
    value: Json,
    schema: SerializedSchema,
  ) => void;
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
 * A reload therefore lands on the right stage with nothing picked. The link
 * still says what was being done, and the value is picked again from the pane
 * that is right there — but the stage has to come BACK to where the screen
 * actually is, or the URL promises a `confirming` step with nothing to confirm
 * and controls that show none. See the effect below.
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

  const { state, stage, fail } = useStageRestore(toPath, "/api/val");
  /*
   * The TARGET's schema, from the live system — the second gate at confirm.
   *
   * Read here rather than in the chrome because it is asked once, about the one
   * field a restore is aimed at, and only when someone commits to it. The marks
   * on every field are `checkCompatibility`, which is schema-against-schema and
   * can be answered without a value; this is value-against-schema, which
   * cannot. `useSchemaAtPath` is a per-path read and this hook is mounted once
   * in the shell, so it is not the per-field cost the field chrome must avoid.
   */
  const targetSchema = useSchemaAtPath(toPath ?? ("" as SourcePath));

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

  /*
   * A reloaded link comes back to a stage the screen can reach.
   *
   * `picked` is component state, so a reload of a `picking-target` or
   * `confirming` URL restores the stage and not the value. The controls then
   * offer a confirm step for a value nobody can see, and "pick a different
   * place" for a place that no longer means anything. Dropping back to
   * `picking-source` is the only stage that is true with nothing picked.
   *
   * `replace: true` so the half-true URL does not become a back-button
   * destination: it never described a state this screen could be in.
   */
  useEffect(() => {
    if (picked !== null) {
      return;
    }
    if (
      history.restore.mode === "picking-target" ||
      history.restore.mode === "confirming"
    ) {
      setHistory(enterRestore(history), { replace: true });
    }
  }, [picked, history, setHistory]);

  const confirm = useCallback(() => {
    if (!picked || !toPath || !patchSet) {
      return;
    }
    /*
     * Refused BEFORE any patch exists, and only for a wrong shape.
     *
     * `checkCompatibility` already refused what it could see from the schemas
     * alone; it answers `unknown` for rich text and for a union value with no
     * discriminator, and the chrome offers those. This is the case that
     * design rule was written for — "refuse type-incompatible, allow
     * validation errors" — and it is the only check that can see the value.
     *
     * A schema that has not loaded is not a pass: nothing is staged until the
     * question can be answered.
     */
    if (targetSchema.status !== "success") {
      fail(
        targetSchema.status === "error"
          ? targetSchema.error
          : "The field this is going into has not loaded yet. Try again in a moment.",
      );
      return;
    }
    const structural = structuralErrorsOfRestore(
      targetSchema.data,
      JSON.parse(JSON.stringify(picked.value)),
    );
    if (structural.length > 0) {
      fail(explainStructuralErrors(structural));
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
  }, [picked, toPath, patchSet, stage, targetSchema, fail]);

  const restoreWholeModule = useCallback(
    (moduleFilePath: ModuleFilePath, value: Json, schema: SerializedSchema) => {
      // A module file path IS the SourcePath of the module root — no module
      // path after it — which is what makes the staged patch a root `replace`.
      const root = moduleFilePath as unknown as SourcePath;
      setPicked({ path: root, value, schema });
      // Both stages in ONE history entry. Two `setHistory` calls would compute
      // the second from a stale `history` and drop the source that was just
      // picked, and would leave a `picking-target` step in the back stack that
      // nobody was ever in.
      setHistory(pickRestoreTarget(pickRestoreSource(history, root), root));
    },
    [history, setHistory],
  );

  const clearTarget = useCallback(() => {
    setHistory(clearRestoreTarget(history));
  }, [history, setHistory]);

  return {
    ...modes,
    from: picked,
    toPath,
    restoreWholeModule,
    stage: state,
    confirm,
    clearTarget,
  };
}
