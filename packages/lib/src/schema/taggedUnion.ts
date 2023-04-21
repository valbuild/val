import {
  Schema,
  SrcOf,
  LocalOf,
  SerializedSchema,
  OptIn,
  OptOut,
} from "./Schema";
import { ObjectSchema } from "./object";

export class LiteralSchema<T extends string> extends Schema<T, T> {
  constructor(public readonly value: T) {
    super(false);
  }
  protected validate(src: T): false | string[] {
    return src === this.value ? false : [`Value must equal ${this.value}`];
  }
  hasI18n(): boolean {
    return false;
  }
  protected localize(src: T): T {
    return src;
  }
  protected delocalizePath(_src: T, localPath: string[]): string[] {
    return localPath;
  }
  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}
export const literal = <T extends string>(value: T): LiteralSchema<T> => {
  return new LiteralSchema(value);
};

type SchemaObject<D extends string> = {
  [d in D]: LiteralSchema<string>;
};

export class TaggedUnionSchema<
  D extends string,
  T extends readonly SchemaObject<D>[],
  Opt extends boolean
> extends Schema<
  OptIn<{ [I in number]: SrcOf<ObjectSchema<T[I], false>> }[number], Opt>,
  OptOut<{ [I in number]: LocalOf<ObjectSchema<T[I], false>> }[number], Opt>
> {
  readonly schemas: Map<string, ObjectSchema<SchemaObject<D>, false>>;

  constructor(
    private readonly discriminator: D,
    schemas: { [I in keyof T]: ObjectSchema<T[I], false> },
    public readonly opt: Opt
  ) {
    super(opt);
    this.schemas = new Map();
    for (const schema of schemas) {
      const discriminatorSchema = schema.props[discriminator];
      const value = discriminatorSchema.value;
      if (this.schemas.has(value)) {
        throw Error(`Duplicate schema for discriminator value ${value}`);
      }
      this.schemas.set(value, schema);
    }
  }
  protected validate(
    src: OptIn<{ [I in number]: SrcOf<ObjectSchema<T[I], false>> }[number], Opt>
  ): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Required tagged union cannot be null"];
      return false;
    }

    const value = src[this.discriminator];
    const schema = this.schemas.get(value as string);
    if (schema === undefined) {
      return [`Tagged union has invalid discriminator value ${value}`];
    }
    return Schema.validate(schema, src);
  }
  hasI18n(): boolean {
    for (const schema of this.schemas.values()) {
      if (schema.hasI18n()) return true;
    }
    return false;
  }
  protected localize(
    src: OptIn<
      { [I in number]: SrcOf<ObjectSchema<T[I], false>> }[number],
      Opt
    >,
    locale: "en_US"
  ): OptOut<
    { [I in number]: LocalOf<ObjectSchema<T[I], false>> }[number],
    Opt
  > {
    if (src === null) {
      if (!this.opt)
        throw Error("Invalid value: Required tagged union cannot be null");
      return src as any;
    }

    const value = src[this.discriminator];
    const schema = this.schemas.get(value as string);
    if (schema === undefined) {
      throw Error(
        `Invalid value: Tagged union has invalid discriminator value ${value}`
      );
    }
    return Schema.localize(schema, src, locale) as any;
  }
  protected delocalizePath(
    src: OptIn<
      { [I in number]: SrcOf<ObjectSchema<T[I], false>> }[number],
      Opt
    >,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (src === null) {
      if (!this.opt) {
        throw Error("Invalid value: Required tagged union cannot be null");
      }

      if (localPath.length > 0) {
        throw Error(
          "Invalid path: Cannot access property of optional tagged union whose value is null"
        );
      }
      return localPath;
    }

    const value = src[this.discriminator];
    const schema = this.schemas.get(value as string);
    if (schema === undefined) {
      throw Error(
        `Invalid value: Tagged union has invalid discriminator value ${value}`
      );
    }
    return Schema.delocalizePath(schema, src, localPath, locale);
  }
  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
  optional(): TaggedUnionSchema<D, T, true> {
    if (this.opt) console.warn("Schema is already optional");
    return new TaggedUnionSchema<D, T, true>(
      this.discriminator,
      [...this.schemas.values()] as {
        [I in keyof T]: ObjectSchema<T[I], false>;
      },
      true
    );
  }
}
export const taggedUnion = <
  D extends string,
  T extends readonly SchemaObject<D>[]
>(
  discriminator: D,
  schemas: { [I in keyof T]: ObjectSchema<T[I], false> }
): TaggedUnionSchema<D, T, false> => {
  return new TaggedUnionSchema<D, T, false>(discriminator, schemas, false);
};
taggedUnion.optional = <D extends string, T extends readonly SchemaObject<D>[]>(
  discriminator: D,
  schemas: { [I in keyof T]: ObjectSchema<T[I], false> }
): TaggedUnionSchema<D, T, true> => {
  return new TaggedUnionSchema<D, T, true>(discriminator, schemas, true);
};
