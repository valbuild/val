import { DetailedObjectDescriptor } from "../descriptor";
import { Source } from "../Source";
import {
  LocalOf,
  maybeOptDesc,
  MaybeOptDesc,
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

export class ObjectSchema<
  T extends SchemaObject,
  Opt extends boolean
> extends Schema<OptIn<SrcObject<T>, Opt>, OptOut<OutObject<T>, Opt>> {
  constructor(private readonly props: T, protected readonly opt: Opt) {
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

  localize(
    src: OptIn<SrcObject<T>, Opt>,
    locale: "en_US"
  ): OptOut<OutObject<T>, Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Non-optional object cannot be null");
      return null as OptOut<OutObject<T>, Opt>;
    }

    return Object.fromEntries(
      Object.entries(this.props).map(([key, schema]) => [
        key,
        schema.localize(src[key], locale),
      ])
    ) as OutObject<T>;
  }

  delocalizePath(
    src: SrcObject<T> | null,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (localPath.length === 0) return localPath;
    const [key, ...tail] = localPath;
    if (!(key in this.props)) {
      throw Error(`${key} is not in schema`);
    }
    return [
      key,
      ...this.props[key].delocalizePath(src?.[key] ?? null, tail, locale),
    ];
  }

  localDescriptor(): MaybeOptDesc<
    DetailedObjectDescriptor<{
      [P in keyof T]: ReturnType<T[P]["localDescriptor"]>;
    }>,
    Opt
  > {
    return maybeOptDesc(
      {
        type: "object",
        props: Object.fromEntries(
          Object.entries(this.props).map(([key, schema]) => [
            key,
            schema.localDescriptor(),
          ])
        ) as { [P in keyof T]: ReturnType<T[P]["localDescriptor"]> },
      },
      this.opt
    );
  }

  rawDescriptor(): MaybeOptDesc<
    DetailedObjectDescriptor<{
      [P in keyof T]: ReturnType<T[P]["rawDescriptor"]>;
    }>,
    Opt
  > {
    return maybeOptDesc(
      {
        type: "object",
        props: Object.fromEntries(
          Object.entries(this.props).map(([key, schema]) => [
            key,
            schema.rawDescriptor(),
          ])
        ) as { [P in keyof T]: ReturnType<T[P]["rawDescriptor"]> },
      },
      this.opt
    );
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
