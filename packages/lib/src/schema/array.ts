import { DetailedArrayDescriptor } from "../descriptor";
import { Source } from "../Source";
import { Schema, SourceOf, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedArraySchema = {
  type: "array";
  schema: SerializedSchema;
};

export class ArraySchema<T extends Schema<Source>> extends Schema<
  SourceOf<T>[]
> {
  constructor(private readonly item: T) {
    super();
  }
  validate(input: SourceOf<T>[]): false | string[] {
    const errors: string[] = [];
    input.forEach((value, index) => {
      const result = this.item.validate(value);
      if (result) {
        errors.push(...result.map((error) => `[${index}]: ${error}`));
      }
    });
    if (errors.length > 0) {
      return errors;
    }
    return false;
  }

  descriptor(): DetailedArrayDescriptor<ReturnType<T["descriptor"]>> {
    return {
      type: "array",
      item: this.item.descriptor() as ReturnType<T["descriptor"]>,
    };
  }

  serialize(): SerializedArraySchema {
    return {
      type: "array",
      schema: this.item.serialize(),
    };
  }

  static deserialize(
    schema: SerializedArraySchema
  ): ArraySchema<Schema<Source>> {
    return new ArraySchema(deserializeSchema(schema.schema));
  }
}
export const array = <T extends Schema<Source>>(schema: T): ArraySchema<T> => {
  return new ArraySchema(schema);
};
