import { SelectorOf, SelectorSource } from "..";
import { Schema } from "../../schema";
import { number } from "../../schema/number";
import { object } from "../../schema/object";
import { string } from "../../schema/string";
import { Source, SourceObject } from "../../Source";

export const union = <
  Tag extends string,
  T extends Schema<SourceObject & { [key in Tag]: string }>[]
>(
  tag: Tag,
  ...object: T
): T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? SelectorOf<S>
    : never
  : never => {
  throw Error("unimplemented");
};
