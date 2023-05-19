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
