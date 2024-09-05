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
    <div>
      {source.map((item, index) => {
        if (schema instanceof ObjectSchema) {
          return Object.entries(schema.items).map(([label, itemSchema]) => {
            return (
              <div>
                <div>{label}</div>
                <Module
                  key={`${label}-${index}`}
                  path={path}
                  source={item[label]}
                  schema={itemSchema as Schema<SelectorSource>}
                />
              </div>
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
    </div>
  );
}

export function ListPreview({ source }: { source: any }) {
  return <div>{`${source.length} items`}</div>;
}
