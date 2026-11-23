import { useCallback } from "react";
import type { SourcePath } from "@valbuild/core";
import { useValSystem } from "../../../stores/react/SystemContext";
import { useChainAndSources } from "../../../stores/react/useChainAndSources";
import { sameDeep, useStoreValue } from "../../../stores/react/useStoreValue";
import {
  type CanvasTextFields,
  canvasTextFields,
  NO_CANVAS_TEXT_FIELDS,
} from "./canvasTextFields";

/**
 * {@link canvasTextFields} for the paths the page reported, as of the latest
 * edit: an edit is what changes what a text holds, and what is empty.
 *
 * The same object until what it SAYS is different. It is read in the shell,
 * where a new one for every field write is a render of the whole Studio for
 * every field write (`docs/plans/studio-write-lag.md`), and in Select, the
 * mode a Studio starts in, a write changes it only when a text is emptied or
 * an empty one is filled. In Select & edit it holds each text's value, so it
 * does move as someone types.
 */
export function useCanvasTextFields(
  paths: readonly SourcePath[],
  editing: boolean,
): CanvasTextFields {
  const val = useValSystem();
  const { subscribe, version } = useChainAndSources(val, true);
  const read = useCallback(
    () =>
      val === null
        ? NO_CANVAS_TEXT_FIELDS
        : canvasTextFields(
            paths,
            val.system.sourceStore.allSources(),
            val.system.schemaStore.all(),
            editing,
          ),
    [val, paths, editing],
  );
  return useStoreValue(subscribe, read, { isSame: sameDeep, version });
}
