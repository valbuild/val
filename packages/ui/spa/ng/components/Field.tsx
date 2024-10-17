import { SerializedSchema, SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import classNames from "classnames";
import { ChevronDown, ChevronsDown } from "lucide-react";
import { useState } from "react";
import { AnimateHeight } from "./AnimateHeight";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { Checkbox } from "../../components/ui/checkbox";
import { emptyOf } from "../../components/fields/emptyOf";
import { JSONValue } from "@valbuild/core/patch";

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
  const { patchPath, addPatch } = useAddPatch(path);
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);

  const [isExpanded, setIsExpanded] = useState(true);
  const source = "data" in sourceAtPath ? sourceAtPath.data : undefined;
  return (
    <div
      className={classNames("p-4 border rounded-lg", {
        "bg-bg-primary": !transparent,
      })}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {"data" in schemaAtPath && schemaAtPath.data?.opt === true && (
            <Checkbox
              checked={source !== null}
              onCheckedChange={(ev) => {
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
              }}
            />
          )}
          {typeof label === "string" && <Label>{label}</Label>}
          {label && typeof label !== "string" && label}
        </div>
        {source !== null && (
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
      <AnimateHeight isOpen={isExpanded && source !== null}>
        {source !== null && (
          <div className="flex flex-col gap-6 pt-6">{children}</div>
        )}
      </AnimateHeight>
    </div>
  );
}
