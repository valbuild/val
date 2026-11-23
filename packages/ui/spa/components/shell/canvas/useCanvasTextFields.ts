import { useMemo } from "react";
import type { SourcePath } from "@valbuild/core";
import { useValSystem } from "../../../stores/react/SystemContext";
import { useChainVersion } from "../../ValProvider";
import {
  type CanvasTextFields,
  canvasTextFields,
  NO_CANVAS_TEXT_FIELDS,
} from "./canvasTextFields";

/**
 * {@link canvasTextFields} for the paths the page reported, as of the latest
 * edit: an edit is what changes what a text holds, and what is empty.
 */
export function useCanvasTextFields(
  paths: readonly SourcePath[],
  editing: boolean,
): CanvasTextFields {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo(() => {
    void chainVersion;
    if (val === null) return NO_CANVAS_TEXT_FIELDS;
    const system = val.system;
    return canvasTextFields(
      paths,
      system.sourceStore.allSources(),
      system.schemaStore.all(),
      editing,
    );
  }, [val, chainVersion, paths, editing]);
}
