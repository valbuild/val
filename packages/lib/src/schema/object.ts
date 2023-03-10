import * as lens from "../lens";
import { newObjectSelector, ObjectSelector } from "../selector/object";
import { Source } from "../Source";
import { Schema, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
};

export type SchemaObject = { [key: string]: Schema<Source, unknown> };
export type InObject<T extends SchemaObject> = {
  [key in keyof T]: lens.InOf<T[key]>;
};
export type OutObject<T extends SchemaObject> = {
  [key in keyof T]: lens.OutOf<T[key]>;
};

export class ObjectSchema<T extends SchemaObject> extends Schema<
  InObject<T>,
  OutObject<T>
> {
  constructor(
    /** @internal */
    readonly schema: T
  ) {
    super();
  }
  validate(input: { [key in keyof T]: lens.InOf<T[key]> }): false | string[] {
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

  descriptor(): {
    type: "object";
    props: {
      [P in keyof T]: ReturnType<T[P]["descriptor"]>;
    };
  } {
    return {
      type: "object",
      props: Object.fromEntries(
        Object.entries(this.schema).map(([key, schema]) => [
          key,
          schema.descriptor(),
        ])
      ) as { [P in keyof T]: ReturnType<T[P]["descriptor"]> },
    };
  }

  select(): ObjectSelector<InObject<T>, T> {
    return newObjectSelector(lens.identity(), this.schema);
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
export const object = <T extends SchemaObject>(schema: T): ObjectSchema<T> => {
  return new ObjectSchema(schema);
};
