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
import { sourcePathOfItem } from "../sourcePathOfItem";

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
        const subPath = sourcePathOfItem(path, index);
        if (schema instanceof ObjectSchema) {
          return Object.entries(schema.items).map(([label, itemSchema]) => {
            const entryPath = sourcePathOfItem(subPath, label);
            return (
              <Field key={entryPath} label={label} path={entryPath}>
                <Module
                  path={entryPath}
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
              path={subPath}
              source={item}
              schema={schema.item as Schema<SelectorSource>}
            />
          );
        }
        return (
          <Module key={index} path={subPath} source={item} schema={schema} />
        );
      })}
    </>
  );
}

export function ListPreview({ source }: { source: any }) {
  return <div>{`${source.length} items`}</div>;
}
