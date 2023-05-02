/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaSrcOf, SerializedSchema } from ".";
import { Source } from "../Source";

export type SerializedArraySchema = {
  type: "array";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

export class ArraySchema<T extends Schema<Source>> extends Schema<
  SchemaSrcOf<T>[]
> {
  constructor(readonly item: T) {
    super();
  }

  protected validate(src: SchemaSrcOf<T>[]): false | string[] {
    throw new Error("Method not implemented.");
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
