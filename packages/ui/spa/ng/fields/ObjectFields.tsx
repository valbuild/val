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
import { Label } from "../components/Label";

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

  if (!source) {
    return <div>Source is null</div>;
  }

  return Object.entries(schema.items).map(([label, itemSchema]) => {
    const key = JSON.stringify({ label, itemSchema });
    if (itemSchema instanceof StringSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <StringField path={path} source={source[label]} schema={itemSchema} />
        </div>
      );
    } else if (itemSchema instanceof NumberSchema) {
      return (
        <div key={key}>
          <div>{label}</div>
          <NumberField path={path} source={source[label]} schema={itemSchema} />
        </div>
      );
    } else if (itemSchema instanceof BooleanSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <BooleanField
            path={path}
            source={source[label]}
            schema={itemSchema}
          />
        </div>
      );
    } else if (itemSchema instanceof ImageSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <ImageField path={path} source={source[label]} schema={itemSchema} />
        </div>
      );
    } else if (itemSchema instanceof ArraySchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <ListFields
            path={path}
            source={source[label]}
            schema={itemSchema.item}
          />
        </div>
      );
    } else if (itemSchema instanceof KeyOfSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <KeyOfField path={path} source={source[label]} schema={itemSchema} />
        </div>
      );
    } else if (itemSchema instanceof UnionSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <UnionField path={path} source={source[label]} schema={itemSchema} />
        </div>
      );
    } else if (itemSchema instanceof ObjectSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <ObjectFields
            path={path}
            source={source[label]}
            schema={itemSchema}
          />
        </div>
      );
    } else if (itemSchema instanceof RichTextSchema) {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <RichTextField
            path={path}
            source={source[label]}
            schema={itemSchema}
          />
        </div>
      );
    } else {
      return (
        <div key={key}>
          <Label>{label}</Label>
          <div>Unknown schema</div>
        </div>
      );
    }
  });
}
