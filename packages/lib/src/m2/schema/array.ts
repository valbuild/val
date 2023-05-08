/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaSrcOf, SerializedSchema } from ".";
import { Source } from "../Source";
import { SourcePath } from "../val";

export type SerializedArraySchema = {
  type: "array";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

export class ArraySchema<T extends Schema<Source>> extends Schema<
  SchemaSrcOf<T>[]
> {
  constructor(readonly item: T, readonly isOptional: boolean = false) {
    super();
  }

  validate(src: SchemaSrcOf<T>[]): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: SchemaSrcOf<T>[]): boolean {
    if (this.isOptional && src === undefined) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all items
    return typeof src === "object" && Array.isArray(src);
  }

  optional(): Schema<SchemaSrcOf<T>[] | undefined> {
    return new ArraySchema(this.item, true);
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const array = <Src extends Source>(
  schema: Schema<Src>
): Schema<Src[]> => {
  return new ArraySchema(schema);
};
