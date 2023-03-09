import { ValidObject } from "../ValidTypes";
import { Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
};

export class ObjectSchema<T extends ValidObject> extends Schema<T> {
  constructor(private readonly schema: { [key in keyof T]: Schema<T[key]> }) {
    super();
  }
  validate(input: T): false | string[] {
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
  ): ObjectSchema<ValidObject> {
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
export const object = <T extends ValidObject>(schema: {
  [key in keyof T]: Schema<T[key]>;
}): Schema<T> => {
  return new ObjectSchema(schema);
};
