import { Source } from "../Source";
import {
  OutOf,
  OptIn,
  OptOut,
  Schema,
  SrcOf,
  type SerializedSchema,
} from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedArraySchema = {
  type: "array";
  schema: SerializedSchema;
  opt: boolean;
};

export class ArraySchema<
  T extends Schema<never, Source>,
  Opt extends boolean
> extends Schema<
  OptIn<readonly SrcOf<T>[], Opt>,
  OptOut<readonly OutOf<T>[], Opt>
> {
  constructor(public readonly item: T, public readonly opt: Opt) {
    super(opt);
  }
  protected validate(src: OptIn<readonly SrcOf<T>[], Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Required array cannot be null"];
      return false;
    }
    const errors: string[] = [];
    src.forEach((value, index) => {
      const result = Schema.validate(this.item, value);
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

  protected transform(
    src: OptIn<readonly SrcOf<T>[], Opt>,
    locale: "en_US"
  ): OptOut<OutOf<T>[], Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Required array cannot be null");
      return null as OptOut<OutOf<T>[], Opt>;
    }
    return src.map((item) => Schema.transform(this.item, item, locale));
  }

  protected delocalizePath(
    src: OptIn<readonly SrcOf<T>[], Opt>,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (localPath.length === 0) return localPath;
    const [idx, ...tail] = localPath;
    if (src === null) {
      if (!this.opt) {
        throw Error("Invalid value: Required array cannot be null");
      }

      if (tail.length !== 0) {
        throw Error(
          "Invalid path: Cannot access item of optional array whose value is null"
        );
      }

      return [idx];
    }

    return [
      idx,
      ...Schema.delocalizePath(this.item, src[Number(idx)], tail, locale),
    ];
  }

  serialize(): SerializedArraySchema {
    return {
      type: "array",
      schema: this.item.serialize(),
      opt: this.opt,
    };
  }

  optional(): ArraySchema<T, true> {
    if (this.opt) console.warn("Schema is already optional");
    return new ArraySchema(this.item, true);
  }

  static deserialize(
    schema: SerializedArraySchema
  ): ArraySchema<Schema<never, Source>, boolean> {
    return new ArraySchema(deserializeSchema(schema.schema), schema.opt);
  }
}
export const array = <T extends Schema<never, Source>>(
  schema: T
): ArraySchema<T, false> => {
  return new ArraySchema(schema, false);
};
array.optional = <T extends Schema<never, Source>>(
  schema: T
): ArraySchema<T, true> => {
  return new ArraySchema(schema, true);
};
