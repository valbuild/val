import {
  SourcePath,
  SerializedStringSchema,
  StringSchema,
} from "@valbuild/core";
import { OnSubmit } from "../SubmitStatus";
import { BasicInputField } from "../BasicInputField";

export function StringField({
  path,
  source,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  source: string | null;
  schema: SerializedStringSchema;
  onSubmit?: OnSubmit;
}) {
  return (
    <BasicInputField
      path={path}
      defaultValue={source}
      schema={schema}
      onSubmit={onSubmit}
      type="text"
      validate={(path, value) => {
        return new StringSchema(
          schema.options
            ? {
                ...schema.options,
                regexp: schema.options.regexp
                  ? new RegExp(
                      schema.options.regexp.source,
                      schema.options.regexp.flags,
                    )
                  : undefined,
              }
            : undefined,
        ).validate(path, value);
      }}
    />
  );
}
