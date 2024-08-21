import { Json, JsonObject, SerializedSchema, SourcePath } from "@valbuild/core";
import { isJsonArray } from "../../utils/isJsonArray";
import { InitOnSubmit, ValFormField } from "./ValFormField";
import { ArrayFields } from "./primitives/ArrayFields";
import { ObjectFields } from "./primitives/ObjectFields";

export function ValDefaultOf({
  source,
  path,
  schema,
  initOnSubmit,
}: {
  source: Json;
  path: SourcePath;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  if (schema.type === "array") {
    if (
      typeof source === "object" &&
      (source === null || isJsonArray(source))
    ) {
      return (
        <ArrayFields
          initOnSubmit={initOnSubmit}
          source={source === null ? [] : source}
          path={path}
          schema={schema}
        />
      );
    }
  } else if (schema.type === "object") {
    if (
      typeof source === "object" &&
      (source === null || !isJsonArray(source))
    ) {
      return (
        <ObjectFields
          source={source as JsonObject}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
        />
      );
    }
  } else if (
    schema.type === "richtext" ||
    schema.type === "string" ||
    schema.type === "image" ||
    schema.type === "number" ||
    schema.type === "keyOf" ||
    schema.type === "boolean" ||
    schema.type === "literal" ||
    schema.type === "union"
  ) {
    return (
      <ValFormField
        key={path}
        path={path}
        source={source}
        schema={schema}
        initOnSubmit={initOnSubmit}
      />
    );
  }

  return (
    <div className="p-4 bg-destructive text-destructive-foreground">
      ERROR: unexpected source type {typeof source} for schema type{" "}
      {schema.type}
    </div>
  );
}
