import { Json, SerializedSchema, SourcePath } from "@valbuild/core";
import { useEffect, useState } from "react";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useLoadingStatus,
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
  const loadingStatus = useLoadingStatus();
  const validationErrors = useValidationErrors(path);
  const { patchPath, addPatch } = useAddPatch(path);
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);

  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [showEmptyFileOrImage, setShowEmptyFileOrImage] = useState(false);

  const sourceData =
    "data" in sourceAtPath ? sourceAtPath.data : undefined;
  const schemaData =
    "data" in schemaAtPath ? schemaAtPath.data : undefined;

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
