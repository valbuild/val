import { ValidObject } from "../ValidTypes";
import { Schema } from "./Schema";
import type { SerializedSchema } from "./SerializedSchema";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
};

class ObjectSchema<T extends ValidObject> extends Schema<T> {
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
}
export const object = <T extends ValidObject>(schema: {
  [key in keyof T]: Schema<T[key]>;
}): Schema<T> => {
  return new ObjectSchema(schema);
};
