/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { SourceObject } from "../source";
import { ValidationError } from "./validation/ValidationError";

export type SerializedUnionSchema = {
  type: "union";
  key: string;
  items: SerializedSchema[];
  opt: boolean;
};

type SourceOf<
  Key extends string,
  T extends Schema<SourceObject & { [k in Key]: string }>[]
> = T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? S
    : never
  : never;

export class UnionSchema<
  Key extends string,
  T extends Schema<SourceObject & { [k in Key]: string }>[]
> extends Schema<SourceOf<Key, T>> {
  validate(src: SourceOf<Key, T>): ValidationError {
    throw new Error("Method not implemented.");
  }
  assert(src: SourceOf<Key, T>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<SourceOf<Key, T> | null> {
    throw new Error("Method not implemented.");
  }
  serialize(): SerializedSchema {
    return {
      type: "union",
      key: this.key,
      items: this.items.map((o) => o.serialize()),
      opt: this.opt,
    };
  }

  constructor(
    readonly key: Key,
    readonly items: T,
    readonly opt: boolean = false
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
