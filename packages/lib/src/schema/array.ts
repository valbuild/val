import { Source } from "../Source";
import { Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedArraySchema = {
  type: "array";
  schema: SerializedSchema;
};

export class ArraySchema<In extends Source, Out> extends Schema<In[], Out[]> {
  constructor(private readonly schema: Schema<In, Out>) {
    super();
  }
  validate(input: In[]): false | string[] {
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

  apply(input: In[]): Out[] {
    return input.map((item) => this.schema.apply(item));
  }

  serialize(): SerializedArraySchema {
    return {
      type: "array",
      schema: this.schema.serialize(),
    };
  }

  static deserialize(
    schema: SerializedArraySchema
  ): ArraySchema<Source, unknown> {
    return new ArraySchema(deserializeSchema(schema.schema));
  }
}
export const array = <In extends Source, Out>(
  schema: Schema<In, Out>
): Schema<In[], Out[]> => {
  return new ArraySchema(schema);
};
