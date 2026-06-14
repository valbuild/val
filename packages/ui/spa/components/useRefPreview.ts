import { useMemo } from "react";
import {
  ImageMetadata,
  ImageSource,
  Internal,
  ListArrayRender,
  ListRecordRender,
  RemoteSource,
  SourcePath,
} from "@valbuild/core";
import { useParent } from "../hooks/useParent";
import { useRenderOverrideAtPath } from "./ValFieldProvider";

export type RefPreview = {
  title: string;
  subtitle?: string | null;
  image?: ImageSource | RemoteSource<ImageMetadata> | null;
};

export function useRefPreview(path: SourcePath): RefPreview | undefined {
  const { path: parentPath, schema: parentSchema } = useParent(path);
  const renderAtPath = useRenderOverrideAtPath(parentPath);

  return useMemo(
    () => resolveRefPreview(path, parentPath, parentSchema, renderAtPath),
    [path, parentPath, parentSchema, renderAtPath],
  );
}

export function resolveRefPreview(
  path: SourcePath,
  parentPath: SourcePath,
  parentSchema: ReturnType<typeof useParent>["schema"],
  renderAtPath: ReturnType<typeof useRenderOverrideAtPath>,
): RefPreview | undefined {
  if (
    parentPath === path ||
    !parentSchema ||
    !renderAtPath ||
    !("data" in renderAtPath) ||
    !renderAtPath.data
  ) {
    return undefined;
  }

  const renderData = renderAtPath.data;
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) {
    return undefined;
  }

  const pathParts = Internal.splitModulePath(modulePath);
  const lastPart = pathParts[pathParts.length - 1];

  if (
    parentSchema.type === "array" &&
    renderData.layout === "list" &&
    renderData.parent === "array"
  ) {
    const arrayRender = renderData as ListArrayRender;
    let index: number;
    try {
      index = JSON.parse(lastPart);
    } catch {
      index = Number(lastPart);
    }
    if (!Number.isNaN(index) && arrayRender.items[index]) {
      return arrayRender.items[index];
    }
  } else if (
    parentSchema.type === "record" &&
    renderData.layout === "list" &&
    renderData.parent === "record"
  ) {
    const recordRender = renderData as ListRecordRender;
    let key: string;
    try {
      key = JSON.parse(lastPart);
    } catch {
      key = lastPart;
    }
    const item = recordRender.items.find(([itemKey]) => itemKey === key);
    if (item) {
      return item[1];
    }
  }

  return undefined;
}
