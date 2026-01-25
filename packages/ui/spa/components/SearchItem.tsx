import { SourcePath, Internal } from "@valbuild/core";
import { Globe } from "lucide-react";
import { PreviewWithRender } from "./PreviewWithRender";
import { useSchemaAtPath } from "./ValFieldProvider";
import { NodeIcon } from "./NodeIcon";

export function SearchItem({
  path,
  size,
}: {
  path: SourcePath;
  size?: "compact";
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const schemaType =
    "data" in schemaAtPath && schemaAtPath.data
      ? schemaAtPath.data.type
      : "loading";
  const parentSchemaAtPath = useSchemaAtPath(Internal.parentOfSourcePath(path));
  const isArrayItem =
    "data" in parentSchemaAtPath && parentSchemaAtPath.data?.type === "array";
  const isParentRouter =
    "data" in parentSchemaAtPath &&
    parentSchemaAtPath.data?.type === "record" &&
    Boolean(parentSchemaAtPath.data?.router);

  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  const lastPart = Internal.splitModulePath(modulePath).pop();
  const formattedPath = isArrayItem ? `#${lastPart}` : lastPart;
  const ItemIcon = isParentRouter ? (
    <Globe size={12} />
  ) : (
    <NodeIcon type={schemaType} size={12} />
  );
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2 text-sm text-fg-tertiary">
        {ItemIcon}
        <span>{formattedPath}</span>
      </div>
      <PreviewWithRender path={path} size={size} />
    </div>
  );
}
