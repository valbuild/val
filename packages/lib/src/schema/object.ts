import { Source } from "../Source";
import { InOf, OutOf, Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
};

export class ObjectSchema<
  T extends { [key: string]: Schema<Source, unknown> }
> extends Schema<
  { [key in keyof T]: InOf<T[key]> },
  { [key in keyof T]: OutOf<T[key]> }
> {
  constructor(private readonly schema: T) {
    super();
  }
  validate(input: { [key in keyof T]: InOf<T[key]> }): false | string[] {
    const errors: string[] = [];
    for (const key in this.schema) {
      const value = input[key];
      const schema = this.schema[key];
      const result = schema.validate(value);
      if (result) {
        errors.push(...result.map((error) => `[${key}]: ${error}`));
      }
    }
    if (errors.length > 0) {
      return errors;
    }
    return false;
  }

  apply(input: { [key in keyof T]: InOf<T[key]> }): {
    [key in keyof T]: OutOf<T[key]>;
  } {
    return Object.fromEntries(
      Object.entries(this.schema).map(([key, schema]) => [
        key,
        schema.apply(input[key]),
      ])
    ) as { [key in keyof T]: OutOf<T[key]> };
  }

  serialize(): SerializedObjectSchema {
    return {
      type: "object",
      schema: Object.fromEntries(
        Object.entries(this.schema).map(([key, schema]) => [
          key,
          schema.serialize(),
        ])
      ),
    };
  }

  static deserialize(
    schema: SerializedObjectSchema
  ): ObjectSchema<{ [key in string]: Schema<Source, unknown> }> {
    return new ObjectSchema(
      Object.fromEntries(
        Object.entries(schema.schema).map(([key, schema]) => [
          key,
          deserializeSchema(schema),
        ])
      )
    );
  }
}
export const object = <T extends { [key: string]: Schema<Source, unknown> }>(
  schema: T
): Schema<
  { [key in keyof T]: InOf<T[key]> },
  { [key in keyof T]: OutOf<T[key]> }
> => {
  return new ObjectSchema(schema);
};
