import { useMemo } from "react";
import { Internal, PreviewItem, SourcePath } from "@valbuild/core";
import { useParent } from "../hooks/useParent";
import { usePreviewAtPath } from "./ValFieldProvider";

export function useRefPreview(path: SourcePath): PreviewItem | undefined {
  const { path: parentPath, schema: parentSchema } = useParent(path);
  const previewAtPath = usePreviewAtPath(parentPath);

  return useMemo(
    () => resolveRefPreview(path, parentPath, parentSchema, previewAtPath),
    [path, parentPath, parentSchema, previewAtPath],
  );
}

export function resolveRefPreview(
  path: SourcePath,
  parentPath: SourcePath,
  parentSchema: ReturnType<typeof useParent>["schema"],
  previewAtPath: ReturnType<typeof usePreviewAtPath>,
): PreviewItem | undefined {
  if (
    parentPath === path ||
    !parentSchema ||
    !previewAtPath ||
    !("data" in previewAtPath) ||
    !previewAtPath.data
  ) {
    return undefined;
  }

  const previewData = previewAtPath.data;
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) {
    return undefined;
  }

  const pathParts = Internal.splitModulePath(modulePath);
  const lastPart = pathParts[pathParts.length - 1];

  if (parentSchema.type === "array" && previewData.parent === "array") {
    let index: number;
    try {
      index = JSON.parse(lastPart);
    } catch {
      index = Number(lastPart);
    }
    // By index, not by position: a windowed preview carries only the items that
    // were asked for. See ArrayPreview.
    const item = previewData.items.find(([itemIndex]) => itemIndex === index);
    if (!Number.isNaN(index) && item) {
      return item[1];
    }
  } else if (
    parentSchema.type === "record" &&
    previewData.parent === "record"
  ) {
    let key: string;
    try {
      key = JSON.parse(lastPart);
    } catch {
      key = lastPart;
    }
    const item = previewData.items.find(([itemKey]) => itemKey === key);
    if (item) {
      return item[1];
    }
  }

  return undefined;
}
