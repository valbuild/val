import { SerializedSchema, SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import classNames from "classnames";
import { ChevronDown, ChevronsDown } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimateHeight } from "./AnimateHeight";
import {
  useAddPatch,
  useErrors,
  useLoadingStatus,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "./ValProvider";
import { Checkbox } from "./designSystem/checkbox";
import { JSONValue } from "@valbuild/core/patch";
import { ArrayAndRecordTools } from "./ArrayAndRecordTools";
import { emptyOf } from "./fields/emptyOf";
import { EmbeddedBooleanField } from "./fields/BooleanField";

export function Field({
  label,
  children,
  path,
  transparent,
  type,
  foldLevel = "1",
}: {
  label?: string | React.ReactNode;
  children: React.ReactNode;
  path: SourcePath;
  transparent?: boolean;
  type: SerializedSchema["type"];
  foldLevel?: "2" | "1";
}) {
  const loadingStatus = useLoadingStatus();
  const { validationErrors } = useErrors();
  const { patchPath, addPatch } = useAddPatch(path);
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);

  const [isExpanded, setIsExpanded] = useState(true);
  const [showEmptyFileOrImage, setShowEmptyFileOrImage] = useState(false);
  useEffect(() => {
    if (
      "data" in sourceAtPath &&
      sourceAtPath.data === null &&
      "data" in schemaAtPath &&
      !schemaAtPath.data.opt &&
      (schemaAtPath.data?.type === "image" ||
        schemaAtPath.data?.type === "file")
    ) {
      setShowEmptyFileOrImage(true);
    }
  }, [sourceAtPath, schemaAtPath]);
  const source = "data" in sourceAtPath ? sourceAtPath.data : undefined;
  const isBoolean =
    "data" in schemaAtPath && schemaAtPath.data?.type === "boolean";
  const isNullable = "data" in schemaAtPath && schemaAtPath.data?.opt === true;
  return (
    <div
      className={classNames("p-4 border rounded-lg", {
        "bg-bg-tertiary": !transparent,
        "border-border-error": validationErrors[path]?.length > 0,
      })}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {!isBoolean && isNullable && (
            <Checkbox
              disabled={loadingStatus === "loading"}
              checked={source !== null || showEmptyFileOrImage}
              onCheckedChange={() => {
                if (
                  (schemaAtPath.data.type === "image" ||
                    schemaAtPath.data.type === "file") &&
                  source === null
                ) {
                  setShowEmptyFileOrImage(true);
                } else {
                  if (source === null) {
                    addPatch([
                      {
                        op: "replace",
                        path: patchPath,
                        value: emptyOf({
                          ...schemaAtPath.data,
                          opt: false, // empty of nullable is null, so we override
                        }) as JSONValue,
                      },
                    ]);
                  } else {
                    addPatch([
                      {
                        op: "replace",
                        path: patchPath,
                        value: null,
                      },
                    ]);
                  }
                }
              }}
            />
          )}
          {isBoolean && (
            <EmbeddedBooleanField
              path={path}
              isNullable={isNullable}
              loadingStatus={loadingStatus}
              source={source}
            />
          )}
          {typeof label === "string" && <Label>{label}</Label>}
          {label && typeof label !== "string" && label}
        </div>
        <div className="flex items-center gap-2">
          {source !== null && (
            <ArrayAndRecordTools path={path} variant={"field"} />
          )}
          {source !== null && !isBoolean && (
            <button
              onClick={() => setIsExpanded((prev) => !prev)}
              className={classNames("transform transition-transform", {
                "rotate-180": isExpanded,
              })}
            >
              {foldLevel === "1" && <ChevronDown size={16} />}
              {foldLevel === "2" && <ChevronsDown size={16} />}
            </button>
          )}
        </div>
      </div>
      {!isBoolean && (
        <AnimateHeight
          isOpen={isExpanded && (source !== null || showEmptyFileOrImage)}
        >
          {(source !== null || showEmptyFileOrImage) && (
            <div className="flex flex-col gap-6 pt-6">{children}</div>
          )}
        </AnimateHeight>
      )}
    </div>
  );
}
