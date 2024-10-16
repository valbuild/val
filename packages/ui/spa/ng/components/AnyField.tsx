import { SourcePath, SerializedSchema } from "@valbuild/core";
import { UnexpectedSchemaType } from "../../components/fields/UnexpectedSourceType";
import { ArrayFields } from "../fields/ArrayFields";
import { BooleanField } from "../fields/BooleanField";
import { ImageField } from "../fields/ImageField";
import { KeyOfField } from "../fields/KeyOfField";
import { NumberField } from "../fields/NumberField";
import { ObjectFields } from "../fields/ObjectFields";
import { RecordFields } from "../fields/RecordFields";
import { RichTextField } from "../fields/RichTextField";
import { StringField } from "../fields/StringField";
import { UnionField } from "../fields/UnionField";

export function AnyField({
  path,
  schema,
}: {
  path: SourcePath;
  schema: SerializedSchema;
}) {
  if (schema.type === "string") {
    return <StringField path={path} />;
  } else if (schema.type === "number") {
    return <NumberField path={path} />;
  } else if (schema.type === "boolean") {
    return <BooleanField path={path} />;
  } else if (schema.type === "image") {
    return <ImageField path={path} />;
  } else if (schema.type === "object") {
    return <ObjectFields path={path} />;
  } else if (schema.type === "array") {
    return <ArrayFields path={path} />;
  } else if (schema.type === "record") {
    return <RecordFields path={path} />;
  } else if (schema.type === "union") {
    return <UnionField path={path} />;
  } else if (schema.type === "keyOf") {
    return <KeyOfField path={path} />;
  } else if (schema.type === "richtext") {
    return <RichTextField path={path} />;
  }
  // TODO: exhaustive check
  return <UnexpectedSchemaType schema={schema} />;
}
