import {
  ArraySchema,
  BooleanSchema,
  ImageSchema,
  KeyOfSchema,
  NumberSchema,
  ObjectSchema,
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
import { KeyOfField } from "./KeyOfField";
import { ImageField } from "./ImageField";
import { UnionField } from "./UnionField";
import { RichTextField } from "./RichTextField";
import { NullSource } from "../components/NullSource";
import { Field } from "../components/Field";

export function ObjectFields({
  source,
  schema,
  path,
}: {
  source: any;
  schema: ObjectSchema<{ [key: string]: Schema<SelectorSource> }>;
  path: SourcePath;
}) {
  if (!source) {
    return <NullSource />;
  }

  return Object.entries(schema.items).map(([label, itemSchema]) => {
    const key = JSON.stringify({ label, itemSchema });
    if (itemSchema instanceof StringSchema) {
      return (
        <Field key={key} label={label}>
          <StringField path={path} source={source[label]} schema={itemSchema} />
        </Field>
      );
    } else if (itemSchema instanceof NumberSchema) {
      return (
        <Field key={key} label={label}>
          <NumberField path={path} source={source[label]} schema={itemSchema} />
        </Field>
      );
    } else if (itemSchema instanceof BooleanSchema) {
      return (
        <Field key={key} label={label}>
          <BooleanField
            path={path}
            source={source[label]}
            schema={itemSchema}
          />
        </Field>
      );
    } else if (itemSchema instanceof ImageSchema) {
      return (
        <Field key={key} label={label}>
          <ImageField path={path} source={source[label]} schema={itemSchema} />
        </Field>
      );
    } else if (itemSchema instanceof ArraySchema) {
      return (
        <Field key={key} label={label}>
          <ListFields
            path={path}
            source={source[label]}
            schema={itemSchema.item}
          />
        </Field>
      );
    } else if (itemSchema instanceof KeyOfSchema) {
      return (
        <Field key={key} label={label}>
          <KeyOfField path={path} source={source[label]} schema={itemSchema} />
        </Field>
      );
    } else if (itemSchema instanceof UnionSchema) {
      return (
        <Field key={key} label={label}>
          <UnionField path={path} source={source[label]} schema={itemSchema} />
        </Field>
      );
    } else if (itemSchema instanceof ObjectSchema) {
      return (
        <Field key={key} label={label}>
          <ObjectFields
            path={path}
            source={source[label]}
            schema={itemSchema}
          />
        </Field>
      );
    } else if (itemSchema instanceof RichTextSchema) {
      return (
        <Field key={key} label={label}>
          <RichTextField
            path={path}
            source={source[label]}
            schema={itemSchema}
          />
        </Field>
      );
    } else {
      return (
        <Field key={key} label={label}>
          <div>Unknown schema</div>
        </Field>
      );
    }
  });
}
