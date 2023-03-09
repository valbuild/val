import { ValidTypes } from "../ValidTypes";
import { Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedArraySchema = {
  type: "array";
  schema: SerializedSchema;
};

export class ArraySchema<T extends ValidTypes> extends Schema<T[]> {
  constructor(private readonly schema: Schema<T>) {
    super();
  }
  validate(input: T[]): false | string[] {
    const errors: string[] = [];
    input.forEach((value, index) => {
      const result = this.schema.validate(value);
      if (result) {
        errors.push(...result.map((error) => `[${index}]: ${error}`));
      }
    });
    if (errors.length > 0) {
      return errors;
    }
    return false;
  }

  serialize(): SerializedArraySchema {
    return {
      type: "array",
      schema: this.schema.serialize(),
    };
  }

  static deserialize(schema: SerializedArraySchema): ArraySchema<ValidTypes> {
    return new ArraySchema(deserializeSchema(schema.schema));
  }
}
export const array = <T extends ValidTypes>(schema: Schema<T>): Schema<T[]> => {
  return new ArraySchema(schema);
};
