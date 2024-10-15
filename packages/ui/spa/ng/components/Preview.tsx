import {
  ArraySchema,
  BooleanSchema,
  ImageSchema,
  Json,
  KeyOfSchema,
  NumberSchema,
  ObjectSchema,
  RecordSchema,
  RichTextSchema,
  Schema,
  SelectorSource,
  StringSchema,
  UnionSchema,
} from "@valbuild/core";
import { StringPreview } from "../fields/StringField";
import { NumberPreview } from "../fields/NumberField";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { BooleanPreview } from "../fields/BooleanField";
import { ImagePreview } from "../fields/ImageField";
import { ListPreview } from "../fields/ArrayFields";
import { KeyOfPreview } from "../fields/KeyOfField";
import { UnionPreview } from "../fields/UnionField";

export function Preview({
  source,
  schema,
}: {
  source: Json;
  schema: Schema<SelectorSource>;
}) {
  if (schema instanceof StringSchema) {
    return <StringPreview source={source} />;
  } else if (schema instanceof NumberSchema) {
    return <NumberPreview source={source} />;
  } else if (schema instanceof BooleanSchema) {
    return <BooleanPreview source={source} />;
  } else if (schema instanceof ImageSchema) {
    return <ImagePreview source={source} />;
  } else if (schema instanceof ArraySchema) {
    return <ListPreview source={source} />;
  } else if (schema instanceof KeyOfSchema) {
    return <KeyOfPreview source={source} />;
  } else if (schema instanceof UnionSchema) {
    return <UnionPreview source={source} />;
  } else if (schema instanceof ObjectSchema && source) {
    return Object.entries(source).map(([key, value]) => (
      <Preview key={key} source={value} schema={schema.items[key]} />
    ));
  } else if (schema instanceof RecordSchema && source) {
    return Object.entries(source).map(([key, value]) => (
      <Preview key={key} source={value} schema={schema.item} />
    ));
  } else if (schema instanceof RichTextSchema) {
    return <div>RichText</div>;
  }

  return <UnexpectedSourceType source={source} schema={schema} />;
}
