import { SourcePath, SerializedBooleanSchema } from "@valbuild/core";
import { useState } from "react";
import { OnSubmit, SubmitStatus } from "../../SubmitStatus";
import { Checkbox } from "../../ui/checkbox";
import { FieldContainer } from "../FieldContainer";

export function BooleanField({
  defaultValue,
  onSubmit,
}: {
  path: SourcePath;
  defaultValue?: boolean | null;
  schema: SerializedBooleanSchema;
  onSubmit?: OnSubmit;
}) {
  const [value, setValue] = useState<boolean | null>(defaultValue ?? null);
  const [loading, setLoading] = useState(false);
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
