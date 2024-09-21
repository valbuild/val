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
import { sourcePathOfItem } from "../sourcePathOfItem";

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
    const subPath = sourcePathOfItem(path, label);
    switch (true) {
      case itemSchema instanceof StringSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <StringField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof NumberSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <NumberField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof BooleanSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <BooleanField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof ImageSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <ImageField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof ArraySchema:
        return (
          <Field
            key={key}
            label={label}
            path={subPath}
            transparent
            foldLevel="2"
          >
            <ListFields
              path={subPath}
              source={source[label]}
              schema={itemSchema.item}
            />
          </Field>
        );
      case itemSchema instanceof KeyOfSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <KeyOfField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof UnionSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <UnionField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof ObjectSchema:
        return (
          <Field
            key={key}
            label={label}
            path={subPath}
            transparent
            foldLevel="2"
          >
            <ObjectFields
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      case itemSchema instanceof RichTextSchema:
        return (
          <Field key={key} label={label} path={subPath}>
            <RichTextField
              path={subPath}
              source={source[label]}
              schema={itemSchema}
            />
          </Field>
        );
      default:
        return (
          <Field key={key} label={label} path={subPath}>
            <div>Unknown schema</div>
          </Field>
        );
    }
  });
}
