import { Schema } from ".";
import { SelectorSource, SelectorOf } from "../selector";
import { SourceObject } from "../Source";

export const union = <
  Key extends string,
  T extends Schema<SourceObject & { [k in Key]: string }>[]
>(
  key: Key,
  ...object: T
): T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? Schema<S>
    : never
  : never => {
  throw Error("unimplemented");
};
