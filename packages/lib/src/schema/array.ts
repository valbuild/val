import { DetailedArrayDescriptor } from "../descriptor";
import { Source } from "../Source";
import { LocalOf, Schema, SrcOf, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedArraySchema = {
  type: "array";
  schema: SerializedSchema;
};

export class ArraySchema<T extends Schema<Source, Source>> extends Schema<
  SrcOf<T>[],
  LocalOf<T>[]
> {
  constructor(private readonly item: T) {
    super();
  }
  validate(input: SrcOf<T>[]): false | string[] {
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

  hasI18n(): ReturnType<T["hasI18n"]> {
    return this.item.hasI18n() as ReturnType<T["hasI18n"]>;
  }

  localize(src: SrcOf<T>[], locale: "en_US"): LocalOf<T>[] {
    return src.map((item) => this.item.localize(item, locale) as LocalOf<T>);
  }

  delocalizePath(
    src: SrcOf<T>[],
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (localPath.length === 0) return localPath;
    const [idx, ...tail] = localPath;
    return [idx, ...this.item.delocalizePath(src[Number(idx)], tail, locale)];
  }

  localDescriptor(): DetailedArrayDescriptor<ReturnType<T["localDescriptor"]>> {
    return {
      type: "array",
      item: this.item.rawDescriptor() as ReturnType<T["localDescriptor"]>,
    };
  }

  rawDescriptor(): DetailedArrayDescriptor<ReturnType<T["rawDescriptor"]>> {
    return {
      type: "array",
      item: this.item.rawDescriptor() as ReturnType<T["rawDescriptor"]>,
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
  ): ArraySchema<Schema<Source, Source>> {
    return new ArraySchema(deserializeSchema(schema.schema));
  }
}
export const array = <T extends Schema<Source, Source>>(
  schema: T
): ArraySchema<T> => {
  return new ArraySchema(schema);
};
