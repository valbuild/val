import {
  Json,
  NumberSchema,
  SerializedNumberSchema,
  SourcePath,
} from "@valbuild/core";
import { BasicInputField } from "../BasicInputField";
import { OnSubmit } from "../SubmitStatus";
import { UnexpectedSourceType } from "../UnexpectedSourceType";

export function NumberField({
  path,
  source,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedNumberSchema;
  onSubmit?: OnSubmit;
}) {
  if (typeof source !== "number") {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
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
