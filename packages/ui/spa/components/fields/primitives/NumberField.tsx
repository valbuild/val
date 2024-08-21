import {
  NumberSchema,
  SerializedNumberSchema,
  SourcePath,
} from "@valbuild/core";
import { BasicInputField } from "../BasicInputField";
import { OnSubmit } from "../SubmitStatus";

export function NumberField({
  path,
  source,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  source: number | null;
  schema: SerializedNumberSchema;
  onSubmit?: OnSubmit;
}) {
  return (
    <BasicInputField
      path={path}
      defaultValue={source?.toString()}
      schema={schema}
      onSubmit={onSubmit}
      type="number"
      validate={(path, value) => {
        return new NumberSchema(schema.options).validate(path, Number(value));
      }}
    />
  );
}
