import { SourcePath, SerializedBooleanSchema, Json } from "@valbuild/core";
import { useState } from "react";
import { OnSubmit, SubmitStatus } from "../SubmitStatus";
import { Checkbox } from "../../ui/checkbox";
import { FieldContainer } from "../FieldContainer";
import { UnexpectedSourceType } from "../UnexpectedSourceType";

export function BooleanField({
  source,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  source?: Json;
  schema: SerializedBooleanSchema;
  onSubmit?: OnSubmit;
}) {
  const [value, setValue] = useState<Json>(source ?? null);
  const [loading, setLoading] = useState(false);
  if (typeof value !== "boolean") {
    return <UnexpectedSourceType source={value} schema={schema} />;
  }
  return (
    <FieldContainer>
      <div className="flex items-center justify-between">
        <Checkbox
          checked={value || false}
          onCheckedChange={(checkedValue) => {
            const value =
              typeof checkedValue === "boolean" ? checkedValue : null;
            setValue(value);
            if (onSubmit) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve([
                  {
                    op: "replace",
                    path,
                    value,
                  },
                ])
              ).finally(() => {
                setLoading(false);
              });
            }
          }}
        />
        <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
      </div>
    </FieldContainer>
  );
}
