import { Schema, SchemaTypeOf } from "./schema";
import { string } from "./schema/string";
import { object } from "./schema/object";
import {
  Selector,
  GenericSelector,
  SelectorOf,
  SelectorSource,
} from "./selector";
import { Source } from "./Source";

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
  throw Error("Not implemented");
}

{
  const s = object({
    foo: string(),
  });
  const a = content("/id", s, {
    foo: "bar",
  });
}
