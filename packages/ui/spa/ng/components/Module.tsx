import {
  ArraySchema,
  BooleanSchema,
  ImageSchema,
  ImageSource,
  Json,
  KeyOfSchema,
  NumberSchema,
  ObjectSchema,
  RecordSchema,
  RichTextSchema,
  Schema,
  SelectorSource,
  SourcePath,
  StringSchema,
  UnionSchema,
} from "@valbuild/core";
import { StringField } from "../fields/StringField";
import { NumberField } from "../fields/NumberField";
import { BooleanField } from "../fields/BooleanField";
import { ListFields } from "../fields/ListFields";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { RecordFields } from "../fields/RecordFields";
import { ObjectFields } from "../fields/ObjectFields";
import { ImageField } from "../fields/ImageField";
import { UnionField } from "../fields/UnionField";
import { KeyOfField } from "../fields/KeyOfField";
import { RichTextField } from "../fields/RichTextField";

export function Module({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: Schema<SelectorSource>;
}) {
  if (schema instanceof StringSchema) {
    return <StringField path={path} source={source} schema={schema} />;
  } else if (schema instanceof NumberSchema) {
    return <NumberField path={path} source={source} schema={schema} />;
  } else if (schema instanceof BooleanSchema) {
    return <BooleanField path={path} source={source} schema={schema} />;
  } else if (schema instanceof ImageSchema) {
    return (
      <ImageField path={path} source={source as ImageSource} schema={schema} />
    );
  } else if (schema instanceof ObjectSchema) {
    return <ObjectFields source={source} schema={schema} path={path} />;
  } else if (schema instanceof ArraySchema) {
    return <ListFields path={path} source={source} schema={schema} />;
  } else if (schema instanceof RecordSchema) {
    return <RecordFields source={source} schema={schema} path={path} />;
  } else if (schema instanceof UnionSchema) {
    return <UnionField path={path} source={source} schema={schema} />;
  } else if (schema instanceof KeyOfSchema) {
    return <KeyOfField path={path} source={source} schema={schema} />;
  } else if (schema instanceof RichTextSchema) {
    return <RichTextField path={path} source={source} schema={schema} />;
  }
  return <UnexpectedSourceType source={source} schema={schema} />;
}
