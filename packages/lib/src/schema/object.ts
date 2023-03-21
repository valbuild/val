import { DetailedObjectDescriptor } from "../descriptor";
import { Source } from "../Source";
import { LocalOf, Schema, SrcOf, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
};

type SchemaObject = { [key: string]: Schema<Source, Source> };
type SrcObject<T extends SchemaObject> = {
  [key in keyof T]: SrcOf<T[key]>;
};
type OutObject<T extends SchemaObject> = {
  [key in keyof T]: LocalOf<T[key]>;
};

type Some<
  T extends { readonly [str in PropertyKey]: boolean } | readonly boolean[]
> = {
  [P in keyof T]: T[P] extends true ? true : never;
}[keyof T] extends never
  ? T[keyof T]
  : true;

export class ObjectSchema<T extends SchemaObject> extends Schema<
  SrcObject<T>,
  OutObject<T>
> {
  constructor(private readonly props: T) {
    super();
  }
  validate(input: SrcObject<T>): false | string[] {
    const errors: string[] = [];
    for (const key in this.props) {
      const value = input[key];
      const schema = this.props[key];
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

  hasI18n(): Some<{ [P in keyof T]: ReturnType<T[P]["hasI18n"]> }> {
    return Object.values(this.props).some((schema) =>
      schema.hasI18n()
    ) as Some<{ [P in keyof T]: ReturnType<T[P]["hasI18n"]> }>;
  }

  localize(src: SrcObject<T>, locale: "en_US"): OutObject<T> {
    return Object.fromEntries(
      Object.entries(this.props).map(([key, schema]) => [
        key,
        schema.localize(src[key], locale),
      ])
    ) as OutObject<T>;
  }

  delocalizePath(
    src: SrcObject<T>,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (localPath.length === 0) return localPath;
    const [key, ...tail] = localPath;
    if (!(key in this.props)) {
      throw Error(`${key} is not in schema`);
    }
    return [key, ...this.props[key].delocalizePath(src[key], tail, locale)];
  }

  localDescriptor(): DetailedObjectDescriptor<{
    [P in keyof T]: ReturnType<T[P]["localDescriptor"]>;
  }> {
    return {
      type: "object",
      props: Object.fromEntries(
        Object.entries(this.props).map(([key, schema]) => [
          key,
          schema.localDescriptor(),
        ])
      ) as { [P in keyof T]: ReturnType<T[P]["localDescriptor"]> },
    };
  }

  rawDescriptor(): DetailedObjectDescriptor<{
    [P in keyof T]: ReturnType<T[P]["rawDescriptor"]>;
  }> {
    return {
      type: "object",
      props: Object.fromEntries(
        Object.entries(this.props).map(([key, schema]) => [
          key,
          schema.rawDescriptor(),
        ])
      ) as { [P in keyof T]: ReturnType<T[P]["rawDescriptor"]> },
    };
  }

  serialize(): SerializedObjectSchema {
    return {
      type: "object",
      schema: Object.fromEntries(
        Object.entries(this.props).map(([key, schema]) => [
          key,
          schema.serialize(),
        ])
      ),
    };
  }

  static deserialize(
    schema: SerializedObjectSchema
  ): ObjectSchema<SchemaObject> {
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
