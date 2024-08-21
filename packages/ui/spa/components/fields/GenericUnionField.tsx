import { JsonObject, SourcePath, SerializedSchema, Json } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import classNames from "classnames";
import { useState, useEffect } from "react";
import { emptyOf } from "./emptyOf";
import { SubmitStatus } from "./SubmitStatus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { AnyVal } from "./ValCompositeFields";
import { InitOnSubmit } from "./ValFormField";
import { FieldContainer } from "./FieldContainer";

export function GenericUnionField({
  field,
  path,
  source,
  schema,
  initOnSubmit,
  top,
}: {
  field?: string;
  source: JsonObject;
  path: SourcePath;
  schema: {
    type: "union";
    key: string;
    items: SerializedSchema[];
    opt: boolean;
  };
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}) {
  const keys = getKeysOfUnionObject(schema);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentSourceAndSchema, setCurrentSourceAndSchema] = useState<{
    source: Json | null;
    schema: SerializedSchema;
  } | null>(null);
  useEffect(() => {
    const key = source[schema.key];
    if (typeof key !== "string") {
      console.error("Expected key to be a string, but got", key);
      return;
    }
    setCurrentKey(key);
    for (const item of schema.items) {
      if (item.type === "object" && item.items[schema.key]) {
        const maybeLiteral = item.items[schema.key];
        if (maybeLiteral.type === "literal") {
          if (maybeLiteral.value === key) {
            setCurrentSourceAndSchema({
              schema: item,
              source,
            });
          }
        }
      }
    }
  }, [schema, source]);
  const [loading, setLoading] = useState<boolean>(false);
  const onSubmit = initOnSubmit(path);
  return (
    <FieldContainer
      key={path}
      className={classNames("flex flex-col gap-y-4", {
        "border-l-2 border-border pl-6": !top,
      })}
    >
      {(field || schema.key) && (
        <div className="text-left">{field || schema.key}</div>
      )}
      <Select
        value={currentKey ?? undefined}
        disabled={loading}
        onValueChange={(key) => {
          setCurrentKey(key);
          for (const item of schema.items) {
            if (item.type === "object" && item.items[schema.key]) {
              const maybeLiteral = item.items[schema.key];
              if (maybeLiteral.type === "literal") {
                if (maybeLiteral.value === key) {
                  const nextSource = {
                    ...Object.fromEntries(
                      Object.keys(item.items).map((key) => [
                        key,
                        emptyOf(item.items[key]),
                      ])
                    ),
                    [schema.key]: key,
                  };
                  setCurrentSourceAndSchema({
                    schema: item,
                    source: nextSource,
                  });
                  setLoading(true);
                  onSubmit(async (path) => {
                    return [
                      {
                        op: "replace",
                        path: path,
                        value: nextSource as JSONValue,
                      },
                    ];
                  }).finally(() => {
                    setLoading(false);
                  });
                  return;
                }
              }
            }
          }
          console.error("Could not find key", key);
        }}
      >
        <div className="relative pr-6">
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {keys.map((tag) => (
              <SelectItem key={tag} value={tag.toString()}>
                {tag.toString()}
              </SelectItem>
            ))}
          </SelectContent>
          <div className="absolute top-2 -right-4">
            <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
          </div>
        </div>
      </Select>
      {currentSourceAndSchema && (
        <AnyVal
          key={JSON.stringify(currentSourceAndSchema.schema)}
          path={path as SourcePath}
          source={currentSourceAndSchema.source}
          schema={currentSourceAndSchema.schema}
          initOnSubmit={initOnSubmit}
          top={top}
        />
      )}
    </FieldContainer>
  );
}

function getKeysOfUnionObject(schema: {
  type: "union";
  key: string;
  items: SerializedSchema[];
  opt: boolean;
}): string[] {
  const keys = [];
  for (const item of schema.items) {
    if (item.type === "object" && item.items[schema.key]) {
      const maybeLiteral = item.items[schema.key];
      if (maybeLiteral.type === "literal") {
        keys.push(maybeLiteral.value);
      }
    }
  }
  return keys;
}
