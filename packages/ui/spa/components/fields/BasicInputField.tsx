import {
  SourcePath,
  SerializedStringSchema,
  ValidationErrors,
  SerializedNumberSchema,
} from "@valbuild/core";
import { useState, useRef, useEffect } from "react";
import { OnSubmit, useBounceSubmit, SubmitStatus } from "./SubmitStatus";
import { Input } from "../ui/input";
import { InlineValidationErrors } from "./InlineValidationErrors";
import { FieldContainer } from "./FieldContainer";

export function BasicInputField({
  defaultValue,
  path,
  onSubmit,
  type,
  validate,
}:
  | {
      onSubmit?: OnSubmit;
      path: SourcePath;
      schema: SerializedStringSchema;
      defaultValue?: string | null;
      type: "text";
      validate: (path: SourcePath, value: string) => ValidationErrors;
    }
  | {
      onSubmit?: OnSubmit;
      path: SourcePath;
      schema: SerializedNumberSchema;
      defaultValue?: string | null;
      type: "number";
      validate: (path: SourcePath, value: string) => ValidationErrors;
    }) {
  const [value, setValue] = useState(defaultValue || "");
  const ref = useRef<HTMLInputElement>(null);
  const [didChange, setDidChange] = useState(false);
  useEffect(() => {
    setDidChange(false);
  }, [path]);
  const validationErrors = validate(path, value);
  const submitStatus = useBounceSubmit(
    didChange,
    value,
    onSubmit,
    async (value, path) => [
      {
        op: "replace",
        path,
        value: type === "number" ? Number(value) : value,
      },
    ],
    ref.current?.value ?? null,
  );
  return (
    <FieldContainer>
      <div className="relative flex gap-2 pr-6">
        <Input
          ref={ref}
          defaultValue={value ?? ""}
          onChange={(e) => {
            setDidChange(true);
            setValue(e.target.value);
          }}
          type={type}
        />
        <div className="absolute top-2 -right-4">
          <SubmitStatus submitStatus={submitStatus} />
        </div>
      </div>
      {validationErrors && validationErrors[path] ? (
        <InlineValidationErrors
          errors={(validationErrors && validationErrors[path]) || []}
        />
      ) : (
        <span></span>
      )}
    </FieldContainer>
  );
}
