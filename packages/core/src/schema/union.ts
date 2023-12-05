/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SelectorSource } from "../selector/index";
import { SourceObject } from "../source";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedUnionSchema = {
  type: "union";
  key?: string;
  items: SerializedSchema[];
  opt: boolean;
};

type SourceOf<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
> = T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? S | (Key extends Schema<infer K> ? K : never)
    : never
  : never;

export class UnionSchema<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
> extends Schema<SourceOf<Key, T>> {
  validate(path: SourcePath, src: SourceOf<Key, T>): ValidationErrors {
    // TODO:
    return false;
  }
  assert(src: SourceOf<Key, T>): boolean {
    return true;
  }
  optional(): Schema<SourceOf<Key, T> | null> {
    return new UnionSchema(this.key, this.items, true);
  }
  serialize(): SerializedSchema {
    if (typeof this.key === "string") {
      return {
        type: "union",
        key: this.key,
        items: this.items.map((o) => o.serialize()),
        opt: this.opt,
      };
    }
    return {
      type: "union",
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
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
>(
  key: Key,
  ...objects: T
): Schema<SourceOf<Key, T>> => {
  return new UnionSchema(key, objects);
};
