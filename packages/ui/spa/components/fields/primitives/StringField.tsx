import {
  SourcePath,
  SerializedStringSchema,
  StringSchema,
  Json,
} from "@valbuild/core";
import { OnSubmit } from "../SubmitStatus";
import { BasicInputField } from "../BasicInputField";
import { UnexpectedSchemaType } from "../UnexpectedSourceType";

export function StringField({
  path,
  source,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedStringSchema;
  onSubmit?: OnSubmit;
}) {
  if (typeof source !== "string") {
    return <UnexpectedSchemaType source={source} schema={schema} />;
  }
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
