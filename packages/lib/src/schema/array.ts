import * as lens from "../lens";
import { Source } from "../Source";
import { Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedArraySchema = {
  type: "array";
  schema: SerializedSchema;
};

export class ArraySchema<T extends Schema<Source, unknown>> extends Schema<
  lens.InOf<T>[],
  lens.OutOf<T>[]
> {
  constructor(private readonly item: T) {
    super();
  }
  validate(input: lens.InOf<T>[]): false | string[] {
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

  apply(input: lens.InOf<T>[]): lens.OutOf<T>[] {
    return input.map((item) => this.item.apply(item)) as lens.OutOf<T>[];
  }

  descriptor(): {
    type: "array";
    item: ReturnType<T["descriptor"]>;
  } {
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
  ): ArraySchema<Schema<Source, unknown>> {
    return new ArraySchema(deserializeSchema(schema.schema));
  }
}
export const array = <T extends Schema<Source, unknown>>(
  schema: T
): ArraySchema<T> => {
  return new ArraySchema(schema);
};
