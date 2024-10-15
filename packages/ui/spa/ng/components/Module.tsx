import { SourcePath } from "@valbuild/core";
import { StringField } from "../fields/StringField";
import { NumberField } from "../fields/NumberField";
import { BooleanField } from "../fields/BooleanField";
import { ArrayFields } from "../fields/ArrayFields";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { RecordFields } from "../fields/RecordFields";
import { ObjectFields } from "../fields/ObjectFields";
import { ImageField } from "../fields/ImageField";
import { UnionField } from "../fields/UnionField";
import { KeyOfField } from "../fields/KeyOfField";
import { RichTextField } from "../fields/RichTextField";
import { useSchemaAtPath } from "../ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
  }
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="module" />;
  }
  const schema = schemaAtPath.data;

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
  return <UnexpectedSourceType schema={schema} />;
}
