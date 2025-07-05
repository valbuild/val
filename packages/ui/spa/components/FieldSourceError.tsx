import { SerializedSchema, SourcePath } from "@valbuild/core";
import { AlertTriangle } from "lucide-react";
import { Button } from "./designSystem/button";
import { useAddPatch } from "./ValProvider";
import { emptyOf } from "./fields/emptyOf";
import { JSONValue } from "@valbuild/core/patch";

export function FieldSourceError({
  error,
  path,
  schema,
}: {
  path: SourcePath;
  error: string;
  schema?:
    | { status: "not-found" }
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "success"; data: SerializedSchema };
}) {
  const { addPatch, patchPath } = useAddPatch(path);
  return (
    <div
      id={path}
      className="flex justify-between items-center px-2 py-3 rounded-lg bg-bg-error-primary text-fg-primary"
    >
      <div>Source error: {error}</div>
      <div className="flex gap-2 items-center">
        {schema &&
          schema.status === "success" &&
          !(schema.data.type === "file" || schema.data.type === "image") && (
            <Button
              variant="outline"
              className="hover:bg-bg-error-secondary-hover"
              onClick={() => {
                addPatch(
                  [
                    {
                      op: "replace",
                      path: patchPath,
                      value: emptyOf(schema.data) as JSONValue,
                    },
                  ],
                  schema.data.type,
                );
              }}
            >
              Fix
            </Button>
          )}
        <AlertTriangle size={16} />
      </div>
    </div>
  );
}
