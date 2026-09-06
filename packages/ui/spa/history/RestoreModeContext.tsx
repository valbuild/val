import type { Json, SerializedSchema, SourcePath } from "@valbuild/core";
import {
  checkCompatibility,
  type Compatibility,
} from "@valbuild/shared/internal";
import React, { useContext, useMemo } from "react";
import { useSourceAtPath } from "../components/ValFieldProvider";

/**
 * What a field needs to know to take part in a restore.
 *
 * A context rather than props threaded through every field component, for the
 * same reason the history pane is a second store system rather than a prop: the
 * field components must not learn that this feature exists. `Field` — the one
 * wrapper every object child renders through — reads this and adds the chrome,
 * and nothing below it changes.
 */
export type RestoreMode = {
  /** Which pane this subtree is. The right offers values; the left takes them. */
  side: "now" | "commit";
  /** The value picked to restore, if one has been. */
  from: { path: SourcePath; value: Json; schema: SerializedSchema } | null;
  /** Where it is going, once that is picked too. */
  toPath: SourcePath | null;
  onPickSource: (
    path: SourcePath,
    value: Json,
    schema: SerializedSchema,
  ) => void;
  onPickTarget: (path: SourcePath) => void;
};

const RestoreModeContext = React.createContext<RestoreMode | null>(null);

export function RestoreModeProvider({
  mode,
  children,
}: {
  mode: RestoreMode | null;
  children: React.ReactNode;
}) {
  return (
    <RestoreModeContext.Provider value={mode}>
      {children}
    </RestoreModeContext.Provider>
  );
}

export function useRestoreMode(): RestoreMode | null {
  return useContext(RestoreModeContext);
}

/**
 * How this particular field stands in the restore being aimed.
 *
 * `null` when restore mode is off or this field has no part to play, so the
 * caller renders exactly what it always did — restore mode adds chrome, it does
 * not replace the field.
 */
export type FieldRestoreRole =
  | { role: "source"; picked: boolean }
  | { role: "target"; picked: boolean; compatibility: Compatibility };

export function useFieldRestoreRole(
  path: SourcePath,
  schema: SerializedSchema | undefined,
): FieldRestoreRole | null {
  const mode = useRestoreMode();
  return useMemo<FieldRestoreRole | null>(() => {
    if (!mode || schema === undefined) {
      return null;
    }
    if (mode.side === "commit") {
      // Nothing to check: a value at a commit is always a legal value of the
      // schema it was stored under. Compatibility is a question about where it
      // is GOING, which is why every mark is on the other pane.
      return { role: "source", picked: mode.from?.path === path };
    }
    if (!mode.from) {
      // No value picked yet, so the left pane has nothing to answer about.
      return null;
    }
    return {
      role: "target",
      picked: mode.toPath === path,
      compatibility: checkCompatibility(
        { schema: mode.from.schema, value: mode.from.value },
        { schema },
      ),
    };
  }, [mode, path, schema]);
}

/**
 * The callbacks, for a field that has decided to act.
 *
 * `pick` reads the value with `useSourceAtPath`, NOT the shallow source the
 * field renders from. A shallow source summarises arrays and records rather
 * than carrying them, so picking one would restore a summary — a field that
 * looked right and wrote something that was never there.
 */
export function useRestorePick(
  path: SourcePath,
  schema: SerializedSchema | undefined,
): (() => void) | null {
  const mode = useRestoreMode();
  const deep = useSourceAtPath(path);
  if (!mode || schema === undefined) {
    return null;
  }
  if (mode.side === "commit") {
    return () => {
      if (deep.status !== "success") {
        return;
      }
      mode.onPickSource(path, deep.data, schema);
    };
  }
  return () => mode.onPickTarget(path);
}
