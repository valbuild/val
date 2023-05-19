import { Schema, SchemaTypeOf } from "./schema";
import { string } from "./schema/string";
import { object } from "./schema/object";
import {
  GenericSelector,
  SelectorOf,
  SelectorSource,
  SourceOrExpr,
} from "./selector";
import { Source } from "./source";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { SourcePath } from "./val";
import { Expr } from "./expr";

const brand = Symbol("ValModule");
export type ValModule<T extends SelectorSource> = SelectorOf<T> &
  ValModuleBrand;

export type ValModuleBrand = {
  [brand]: "ValModule";
};

export type TypeOfValModule<T extends ValModule<SelectorSource>> =
  T extends GenericSelector<infer S> ? S : never;

export function content<T extends Schema<SelectorSource>>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  source: SchemaTypeOf<T>
): ValModule<SchemaTypeOf<T>> {
  return newSelectorProxy(source, id as SourcePath, schema);
}

{
  const s = object({
    foo: string(),
  });
  const a = content("/id", s, {
    foo: "bar",
  });
}

export function getRawSource(valModule: ValModule<SelectorSource>): Source {
  const sourceOrExpr = valModule[SourceOrExpr];
  if (sourceOrExpr instanceof Expr) {
    throw Error("Cannot get raw source of an Expr");
  }
  const source = sourceOrExpr;
  return source;
}

export function getSourceAtPath(
  path: SourcePath,
  valModule: ValModule<SelectorSource>
) {
  const parts = parsePath(path.slice(path.indexOf(".") + 1));
  let current: any = valModule;
  for (const part of parts) {
    if (typeof current !== "object") {
      throw Error("Invalid path");
    }
    current = current[part];
  }
  return current;
}

export function parsePath(input: string) {
  const result = [];
  let i = 0;

  while (i < input.length) {
    let part = "";

    if (input[i] === '"') {
      // Parse a quoted string
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && input[i + 1] === '"') {
          // Handle escaped double quotes
          part += '"';
          i++;
        } else {
          part += input[i];
        }
        i++;
      }
      if (input[i] !== '"') {
        throw new Error(
          `Invalid input (${JSON.stringify(
            input
          )}): Missing closing double quote: ${
            input[i] ?? "at end of string"
          } (char: ${i}; length: ${input.length})`
        );
      }
    } else {
      // Parse a regular string
      while (i < input.length && input[i] !== ".") {
        part += input[i];
        i++;
      }
    }

    if (part !== "") {
      result.push(part);
    }

    i++;
  }

  return result;
}
