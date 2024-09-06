import {
  SourcePath,
  Json,
  SelectorSource,
  Schema,
  ArraySchema,
  ObjectSchema,
} from "@valbuild/core";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { Module } from "../components/Module";
import { NullSource } from "../components/NullSource";
import { Field } from "../components/Field";

export function ListFields({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: ArraySchema<Schema<SelectorSource>>;
}) {
  if (!source) {
    return <NullSource />;
  }
  if (!Array.isArray(source)) {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
  return (
    <>
      {source.map((item, index) => {
        if (schema instanceof ObjectSchema) {
          return Object.entries(schema.items).map(([label, itemSchema]) => {
            return (
              <Field key={`${label}-${index}`} label={label}>
                <Module
                  path={path}
                  source={item[label]}
                  schema={itemSchema as Schema<SelectorSource>}
                />
              </Field>
            );
          });
        } else if (schema instanceof ArraySchema) {
          return (
            <Module
              key={index}
              path={path}
              source={item}
              schema={schema.item as Schema<SelectorSource>}
            />
          );
        }
        return <Module key={index} path={path} source={item} schema={schema} />;
      })}
    </>
  );
}

export function ListPreview({ source }: { source: any }) {
  return <div>{`${source.length} items`}</div>;
}
