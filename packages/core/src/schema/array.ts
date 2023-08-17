/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { ValidationError } from "./validation/ValidationError";

export type SerializedArraySchema = {
  type: "array";
  item: SerializedSchema;
  opt: boolean;
};

export class ArraySchema<T extends Schema<SelectorSource>> extends Schema<
  SchemaTypeOf<T>[]
> {
  constructor(readonly item: T, readonly opt: boolean = false) {
    super();
  }

  validate(src: SchemaTypeOf<T>[]): ValidationError {
    throw new Error("Method not implemented.");
  }

  match(src: SchemaTypeOf<T>[]): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all items
    return typeof src === "object" && Array.isArray(src);
  }

  optional(): Schema<SchemaTypeOf<T>[] | null> {
    return new ArraySchema(this.item, true);
  }

  serialize(): SerializedArraySchema {
    return {
      type: "array",
      item: this.item.serialize(),
      opt: this.opt,
    };
  }
}

export const array = <S extends Schema<SelectorSource>>(
  schema: S
): Schema<SchemaTypeOf<S>[]> => {
  return new ArraySchema(schema);
};
