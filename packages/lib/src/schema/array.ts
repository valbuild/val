import { DetailedArrayDescriptor } from "../descriptor";
import { Source } from "../Source";
import {
  LocalOf,
  MaybeOptDesc,
  maybeOptDesc,
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
  T extends Schema<Source, Source>,
  Opt extends boolean
> extends Schema<OptIn<SrcOf<T>[], Opt>, OptOut<LocalOf<T>[], Opt>> {
  constructor(private readonly item: T, protected readonly opt: Opt) {
    super(opt);
  }
  validate(src: OptIn<SrcOf<T>[], Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Non-optional array cannot be null"];
      return false;
    }
    const errors: string[] = [];
    src.forEach((value, index) => {
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

  localize(
    src: OptIn<SrcOf<T>[], Opt>,
    locale: "en_US"
  ): OptOut<LocalOf<T>[], Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Non-optional array cannot be null");
      return null as OptOut<LocalOf<T>[], Opt>;
    }
    return src.map((item) => this.item.localize(item, locale) as LocalOf<T>);
  }

  delocalizePath(
    src: SrcOf<T>[] | null,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (localPath.length === 0) return localPath;
    const [idx, ...tail] = localPath;
    return [
      idx,
      ...this.item.delocalizePath(src?.[Number(idx)] ?? null, tail, locale),
    ];
  }

  localDescriptor(): MaybeOptDesc<
    DetailedArrayDescriptor<ReturnType<T["localDescriptor"]>>,
    Opt
  > {
    return maybeOptDesc(
      {
        type: "array",
        item: this.item.localDescriptor() as ReturnType<T["localDescriptor"]>,
      },
      this.opt
    );
  }

  rawDescriptor(): MaybeOptDesc<
    DetailedArrayDescriptor<ReturnType<T["rawDescriptor"]>>,
    Opt
  > {
    return maybeOptDesc(
      {
        type: "array",
        item: this.item.rawDescriptor() as ReturnType<T["rawDescriptor"]>,
      },
      this.opt
    );
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
  ): ArraySchema<Schema<Source, Source>, boolean> {
    return new ArraySchema(deserializeSchema(schema.schema), schema.opt);
  }
}
export const array = <T extends Schema<Source, Source>>(
  schema: T
): ArraySchema<T, false> => {
  return new ArraySchema(schema, false);
};
