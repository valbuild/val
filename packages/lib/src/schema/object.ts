import { Source } from "../Source";
import { InOf, OutOf, Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
};

type SchemaObject = { [key: string]: Schema<Source, unknown> };
type InObject<T extends SchemaObject> = {
  [key in keyof T]: InOf<T[key]>;
};
type OutObject<T extends SchemaObject> = {
  [key in keyof T]: OutOf<T[key]>;
};

export class ObjectSchema<T extends SchemaObject> extends Schema<
  InObject<T>,
  OutObject<T>
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

  apply(input: InObject<T>): OutObject<T> {
    return Object.fromEntries(
      Object.entries(this.schema).map(([key, schema]) => [
        key,
        schema.apply(input[key]),
      ])
    ) as OutObject<T>;
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
export const object = <T extends SchemaObject>(
  schema: T
): Schema<InObject<T>, OutObject<T>> => {
  return new ObjectSchema(schema);
};
