import { useMemo } from "react";
import {
  SourcePath,
  ImageSource,
  ImageMetadata,
  RemoteSource,
  Internal,
  ListArrayRender,
  ListRecordRender,
} from "@valbuild/core";
import { ListPreviewItem } from "./ListPreviewItem";
import { Preview } from "./Preview";
import { useParent } from "../hooks/useParent";
import { useRenderOverrideAtPath } from "./ValFieldProvider";

export function PreviewWithRender({
  path,
  className,
}: {
  path: SourcePath;
  className?: string;
}) {
  const { path: parentPath, schema: parentSchema } = useParent(path);
  const renderAtPath = useRenderOverrideAtPath(parentPath);

  // Extract render data if parent has list render
  const render = useMemo(():
    | {
        title: string;
        subtitle?: string | null;
        image?: ImageSource | RemoteSource<ImageMetadata> | null;
      }
    | undefined => {
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

    // Extract the last part of the path (index for arrays, key for records)
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (!modulePath) {
      return undefined;
    }

    const pathParts = Internal.splitModulePath(modulePath);
    const lastPart = pathParts[pathParts.length - 1];

    // Handle array render
    if (
      parentSchema.type === "array" &&
      renderData.layout === "list" &&
      renderData.parent === "array"
    ) {
      const arrayRender = renderData as ListArrayRender;
      // Parse the last part as a number (array index)
      // It might be JSON stringified or just a number
      let index: number;
      try {
        index = JSON.parse(lastPart);
      } catch {
        index = Number(lastPart);
      }
      if (!Number.isNaN(index) && arrayRender.items[index]) {
        return arrayRender.items[index];
      }
    }
    // Handle record render
    else if (
      parentSchema.type === "record" &&
      renderData.layout === "list" &&
      renderData.parent === "record"
    ) {
      const recordRender = renderData as ListRecordRender;
      // Parse the last part as a string (record key)
      // It might be JSON stringified or just a string
      let key: string;
      try {
        key = JSON.parse(lastPart);
      } catch {
        key = lastPart;
      }
      // Find the item in renderData.items where the first element matches the key
      const item = recordRender.items.find(([itemKey]) => itemKey === key);
      if (item) {
        return item[1]; // item[1] contains { title, subtitle, image }
      }
    }

    return undefined;
  }, [path, parentPath, parentSchema, renderAtPath]);

  if (render) {
    return (
      <ListPreviewItem
        title={render.title}
        image={render.image ?? null}
        subtitle={render.subtitle ?? null}
        className={className}
      />
    );
  }
  if (className) {
    return (
      <div className={className}>
        <Preview path={path} />
      </div>
    );
  }
  return <Preview path={path} />;
}
