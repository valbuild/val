/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { Source } from "../Source";
import { SourcePath } from "../val";

export type SerializedArraySchema = {
  type: "array";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

export class ArraySchema<T extends Schema<SelectorSource>> extends Schema<
  SchemaTypeOf<T>[]
> {
  constructor(readonly item: T, readonly isOptional: boolean = false) {
    super();
  }

  validate(src: SchemaTypeOf<T>[]): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: SchemaTypeOf<T>[]): boolean {
    if (this.isOptional && src === undefined) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all items
    return typeof src === "object" && Array.isArray(src);
  }

  optional(): Schema<SchemaTypeOf<T>[] | undefined> {
    return new ArraySchema(this.item, true);
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const array = <S extends Schema<SelectorSource>>(
  schema: S
): Schema<SchemaTypeOf<S>[]> => {
  return new ArraySchema(schema);
};
