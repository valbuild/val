import {
  Json,
  LiteralSchema,
  ObjectSchema,
  Schema,
  SelectorSource,
  SourcePath,
  UnionSchema,
} from "@valbuild/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../components/ui/select";
import { useEffect, useState } from "react";
import { SelectValue } from "@radix-ui/react-select";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { NullSource } from "../components/NullSource";

function isStringUnion(
  schema: UnionSchema<LiteralSchema<string> | string, any>
): schema is UnionSchema<LiteralSchema<string>, any> {
  return schema.key instanceof LiteralSchema;
}

export function UnionField({
  source,
  schema,
  path,
}: {
  source: Json;
  schema: UnionSchema<LiteralSchema<string> | string, any>;
  path: SourcePath;
}) {
  const [selected, setSelected] = useState<string | undefined>();
  const [stringUnionValues, setStringUnionValues] = useState<
    LiteralSchema<string>[]
  >([]);

  useEffect(() => {
    if (isStringUnion(schema)) {
      setSelected(schema.key.value);
      setStringUnionValues([schema.key].concat(schema.items));
      return;
    }
    if (typeof schema.key === "string") {
      setSelected(source[schema.key]);
      return;
    }
  }, [source]);

  if (!source) {
    return <NullSource />;
  }

  if (isStringUnion(schema) && selected) {
    return (
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger>
          <SelectValue placeholder="Select a value" />
        </SelectTrigger>
        <SelectContent>
          {stringUnionValues.map((item: LiteralSchema<string>) => (
            <SelectItem key={item.value} value={item.value}>
              {item.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (typeof schema.key === "string" && selected) {
    return (
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger>
          <SelectValue placeholder="Select a value" />
        </SelectTrigger>
        <SelectContent>
          {schema.items.map(
            (item: ObjectSchema<{ [key: string]: Schema<SelectorSource> }>) => {
              return Object.entries(item.items).map(([label, itemSchema]) => {
                if (itemSchema instanceof LiteralSchema) {
                  return (
                    <SelectItem key={itemSchema.value} value={itemSchema.value}>
                      {itemSchema.value}
                    </SelectItem>
                  );
                }
              });
            }
          )}
        </SelectContent>
      </Select>
    );
  }

  return <UnexpectedSourceType source={source} schema={schema} />;
}

export function UnionPreview({ source }: { source: any }) {
  return <div>{source}</div>;
}
