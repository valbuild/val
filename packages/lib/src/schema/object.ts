import { Source } from "../Source";
import {
  LocalOf,
  OptIn,
  OptOut,
  Schema,
  SrcOf,
  type SerializedSchema,
} from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedObjectSchema = {
  type: "object";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

export type SchemaObject = { [key: string]: Schema<never, Source> };
type SrcObject<T extends SchemaObject> = {
  readonly [key in keyof T]: SrcOf<T[key]>;
};
type LocalObject<T extends SchemaObject> = {
  readonly [key in keyof T]: LocalOf<T[key]>;
};

type Some<
  T extends { readonly [str in PropertyKey]: boolean } | readonly boolean[]
> = {
  [P in keyof T]: T[P] extends true ? true : never;
}[keyof T] extends never
  ? T[keyof T]
  : true;

export class ObjectSchema<
  T extends SchemaObject,
  Opt extends boolean
> extends Schema<OptIn<SrcObject<T>, Opt>, OptOut<LocalObject<T>, Opt>> {
  constructor(public readonly props: T, public readonly opt: Opt) {
    super(opt);
  }
  validate(src: OptIn<SrcObject<T>, Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Non-optional object cannot be null"];
      return false;
    }
    const errors: string[] = [];
    for (const key in this.props) {
      const value = src[key];
      const schema = this.props[key];
      const result = Schema.validate(schema, value);
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

  localize(
    src: OptIn<SrcObject<T>, Opt>,
    locale: "en_US"
  ): OptOut<LocalObject<T>, Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Non-optional object cannot be null");
      return null as OptOut<LocalObject<T>, Opt>;
    }

    return Object.fromEntries(
      Object.entries(this.props).map(([key, schema]) => [
        key,
        Schema.localize(schema, src[key] as SrcOf<typeof schema>, locale),
      ])
    ) as LocalObject<T>;
  }

  delocalizePath(
    src: OptIn<SrcObject<T>, Opt>,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (localPath.length === 0) return localPath;
    const [key, ...tail] = localPath;
    if (!(key in this.props)) {
      throw Error(`Invalid path: ${key} is not in schema`);
    }
    if (src === null) {
      if (!this.opt) {
        throw Error("Invalid value: Non-optional object cannot be null");
      }

      if (tail.length !== 0) {
        throw Error(
          "Invalid path: Cannot access property of optional object whose value is null"
        );
      }

      return [key];
    }

    return [
      key,
      ...Schema.delocalizePath(
        this.props[key],
        src[key] as SrcOf<Schema<never, Source>>,
        tail,
        locale
      ),
    ];
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
      opt: this.opt,
    };
  }

  optional(): ObjectSchema<T, true> {
    if (this.opt) console.warn("Schema is already optional");
    return new ObjectSchema(this.props, true);
  }

  static deserialize(
    schema: SerializedObjectSchema
  ): ObjectSchema<SchemaObject, boolean> {
    return new ObjectSchema(
      Object.fromEntries(
        Object.entries(schema.schema).map(([key, schema]) => [
          key,
          deserializeSchema(schema),
        ])
      ),
      schema.opt
    );
  }
}
export const object = <T extends SchemaObject>(
  schema: T
): ObjectSchema<T, false> => {
  return new ObjectSchema(schema, false);
};
object.optional = <T extends SchemaObject>(
  schema: T
): ObjectSchema<T, true> => {
  return new ObjectSchema(schema, true);
};
