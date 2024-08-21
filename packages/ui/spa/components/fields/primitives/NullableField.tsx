import { SourcePath, Json, SerializedSchema } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { useState, useEffect } from "react";
import { emptyOf } from "../../emptyOf";
import { Path } from "../../Path";
import { AnyVal } from "../ValCompositeFields";
import { InitOnSubmit } from "../ValFormField";
import { FieldContainer } from "../FieldContainer";
import { Checkbox } from "../../ui/checkbox";
import { ValDefaultOf } from "../DefaultField";

export function NullableField({
  path,
  source,
  schema,
  initOnSubmit,
  field,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
  field?: string;
}) {
  const [enable, setEnable] = useState<boolean>(source !== null);
  const onSubmit = initOnSubmit(path);
  const [loading, setLoading] = useState<boolean>(false);
  useEffect(() => {
    setEnable(source !== null);
  }, [source]);

  return (
    <FieldContainer className="flex flex-col" key={path}>
      <div className="relative flex items-center justify-between w-full gap-4 pr-3">
        <div
          className="truncate max-w-[300px] text-left"
          title={path}
          dir="rtl"
        >
          {field ? field : <Path>{path}</Path>}
        </div>
        <Checkbox
          disabled={loading}
          checked={enable}
          onCheckedChange={(e) => {
            if (typeof e === "boolean") {
              setLoading(true);
              onSubmit(async (path) => {
                return [
                  {
                    op: "replace",
                    path,
                    value: (e
                      ? source === null
                        ? emptyOf(schema)
                        : source
                      : null) as JSONValue,
                  },
                ];
              })
                .then(() => {
                  setEnable(e);
                })
                .finally(() => {
                  setLoading(false);
                });
            } else {
              console.error("Expected boolean, but got", e);
            }
          }}
        />
      </div>
      {enable && source === null && (
        <ValDefaultOf
          source={emptyOf(schema)}
          schema={schema}
          path={path}
          initOnSubmit={initOnSubmit}
        />
      )}
      {enable && source !== null && (
        <AnyVal
          path={path}
          source={source}
          schema={{ ...schema, opt: false }}
          initOnSubmit={initOnSubmit}
        />
      )}
    </FieldContainer>
  );
}
