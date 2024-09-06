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
    const renderField = () => {
      switch (true) {
        case itemSchema instanceof StringSchema:
          return (
            <StringField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof NumberSchema:
          return (
            <NumberField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof BooleanSchema:
          return (
            <BooleanField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof ImageSchema:
          return (
            <ImageField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof ArraySchema:
          return (
            <ListFields
              path={path}
              source={source[label]}
              schema={itemSchema.item}
            />
          );
        case itemSchema instanceof KeyOfSchema:
          return (
            <KeyOfField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof UnionSchema:
          return (
            <UnionField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof ObjectSchema:
          return (
            <ObjectFields
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        case itemSchema instanceof RichTextSchema:
          return (
            <RichTextField
              path={path}
              source={source[label]}
              schema={itemSchema}
            />
          );
        default:
          return <div>Unknown schema</div>;
      }
    };

    return (
      <Field key={key} label={label}>
        {renderField()}
      </Field>
    );
  });
}
