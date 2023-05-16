import { Schema, SerializedSchema } from ".";
import { SelectorSource, SelectorOf } from "../selector";
import { SourceObject } from "../source";
import { SourcePath } from "../val";

type SourceOf<
  Key extends string,
  T extends Schema<SourceObject & { [k in Key]: string }>[]
> = T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? S
    : never
  : never;

class UnionSchema<
  Key extends string,
  T extends Schema<SourceObject & { [k in Key]: string }>[]
> extends Schema<SourceOf<Key, T>> {
  validate(src: SourceOf<Key, T>): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }
  match(src: SourceOf<Key, T>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<SourceOf<Key, T> | null> {
    throw new Error("Method not implemented.");
  }
  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }

  constructor(
    readonly key: Key,
    readonly objects: T,
    readonly isOptional: boolean = false
  ) {
    super();
  }
}

export const union = <
  Key extends string,
  T extends Schema<SourceObject & { [k in Key]: string }>[]
>(
  key: Key,
  ...objects: T
): Schema<SourceOf<Key, T>> => {
  return new UnionSchema(key, objects);
};
