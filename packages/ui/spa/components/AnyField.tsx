import { SourcePath, SerializedSchema } from "@valbuild/core";
import { ArrayFields } from "./fields/ArrayFields";
import { BooleanField } from "./fields/BooleanField";
import { ImageField } from "./fields/ImageField";
import { KeyOfField } from "./fields/KeyOfField";
import { NumberField } from "./fields/NumberField";
import { ObjectFields } from "./fields/ObjectFields";
import { RecordFields } from "./fields/RecordFields";
import { RichTextField } from "./fields/RichTextField";
import { StringField } from "./fields/StringField";
import { UnionField } from "./fields/UnionField";
import { DateField } from "./fields/DateField";
import { FieldSchemaError } from "./FieldSchemaError";
import { FileField } from "./fields/FileField";

export function AnyField({
  path,
  schema,
  autoFocus,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  autoFocus?: boolean;
}) {
  if (schema.type === "string") {
    return <StringField key={path} path={path} autoFocus={autoFocus} />;
  } else if (schema.type === "number") {
    return <NumberField key={path} path={path} />;
  } else if (schema.type === "boolean") {
    return <BooleanField key={path} path={path} />;
  } else if (schema.type === "image") {
    return <ImageField key={path} path={path} />;
  } else if (schema.type === "object") {
    return <ObjectFields key={path} path={path} />;
  } else if (schema.type === "array") {
    return <ArrayFields key={path} path={path} />;
  } else if (schema.type === "record") {
    return <RecordFields key={path} path={path} />;
  } else if (schema.type === "union") {
    return <UnionField key={path} path={path} />;
  } else if (schema.type === "keyOf") {
    return <KeyOfField key={path} path={path} />;
  } else if (schema.type === "richtext") {
    return <RichTextField key={path} path={path} autoFocus={autoFocus} />;
  } else if (schema.type === "date") {
    return <DateField key={path} path={path} />;
  } else if (schema.type === "file") {
    return <FileField key={path} path={path} />;
  } else if (schema.type === "literal") {
    return (
      <FieldSchemaError path={path} error="Literal fields are not editable" />
    );
  } else {
    const exhaustiveCheck: never = schema;
    return (
      <FieldSchemaError
        path={path}
        error={"Unexpected field schema: " + JSON.stringify(exhaustiveCheck)}
      />
    );
  }
}
