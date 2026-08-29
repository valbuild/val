import { Json, SerializedSchema, SourcePath } from "@valbuild/core";
import { useEffect, useState } from "react";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  type LoadingStatus,
} from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";

export function useFieldState(
  path: SourcePath,
  type: SerializedSchema["type"],
  overrides?: {
    source: Json | null;
    schema: SerializedSchema;
  },
  initialExpanded = true,
) {
  const validationErrors = useValidationErrors(path);
  const { patchPath, addPatch } = useAddPatch(path);
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);

  /**
   * Is THIS field's data ready? Read from this field's own two reads.
   *
   * It used to be `useLoadingStatus()`, which is a different question: that hook
   * answers whether the write queue has caught up, and it is a whole-project
   * subscription. `Field` wraps every leaf field in the editor, so every save
   * round trip re-rendered the entire mounted tree twice — `success` to
   * `loading` and back — and while it was in flight every nullable checkbox and
   * every boolean toggle in the Studio went disabled, because that is what this
   * value gates.
   *
   * Both of those are wrong for the same reason: a save somewhere else says
   * nothing about whether this field can be rendered or operated. The reads
   * above already say, per path, and they are the reads this component makes
   * anyway.
   */
  const loadingStatus: LoadingStatus =
    schemaAtPath.status === "loading" || sourceAtPath.status === "loading"
      ? "loading"
      : schemaAtPath.status === "error" || sourceAtPath.status === "error"
        ? "error"
        : "success";

  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [showEmptyFileOrImage, setShowEmptyFileOrImage] = useState(false);

  const sourceData = "data" in sourceAtPath ? sourceAtPath.data : undefined;
  const schemaData = "data" in schemaAtPath ? schemaAtPath.data : undefined;

  useEffect(() => {
    if (overrides) return;
    if (
      sourceData === null &&
      schemaData &&
      !schemaData.opt &&
      (schemaData.type === "image" || schemaData.type === "file")
    ) {
      setShowEmptyFileOrImage(true);
    }
  }, [sourceData, schemaData?.opt, schemaData?.type, overrides]);

  const source = overrides ? overrides.source : sourceData;
  const schema = overrides ? overrides.schema : schemaData;
  const isBoolean = schema?.type === "boolean";
  const isNullable = schema?.opt === true;

  return {
    loadingStatus,
    validationErrors,
    patchPath,
    addPatch,
    schemaAtPath,
    sourceAtPath,
    isExpanded,
    setIsExpanded,
    showEmptyFileOrImage,
    setShowEmptyFileOrImage,
    source,
    schema,
    isBoolean,
    isNullable,
  };
}
