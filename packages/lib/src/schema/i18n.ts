import { DetailedRecordDescriptor } from "../descriptor";
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

export type SerializedI18nSchema = {
  type: "i18n";
  schema: SerializedSchema;
  opt: boolean;
};

export class I18nSchema<
  T extends Schema<Source, Source>,
  Opt extends boolean
> extends Schema<
  OptIn<Record<"en_US", SrcOf<T>>, Opt>,
  OptOut<LocalOf<T>, Opt>
> {
  constructor(private readonly schema: T, protected readonly opt: Opt) {
    super(opt);

    if (schema.hasI18n()) {
      console.warn("Nested i18n detected. ");
    }
  }
  validate(src: OptIn<Record<"en_US", SrcOf<T>>, Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Non-optional i18n cannot be null"];
      return false;
    }
    const errors: string[] = [];
    for (const key in src) {
      const value = src[key as "en_US"];
      const result = this.schema.validate(value);
      if (result) {
        errors.push(...result.map((error) => `[${key}]: ${error}`));
      }
    }
    if (errors.length > 0) {
      return errors;
    }
    return false;
  }

  hasI18n(): true {
    return true;
  }

  localize(
    src: OptIn<Record<"en_US", SrcOf<T>>, Opt>,
    locale: "en_US"
  ): OptOut<LocalOf<T>, Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Non-optional i18n cannot be null");
      return null as OptOut<LocalOf<T>, Opt>;
    }
    return this.schema.localize(src[locale], locale) as LocalOf<T>;
  }

  delocalizePath(
    src: Record<"en_US", SrcOf<T>> | null,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    return [
      locale,
      ...this.schema.delocalizePath(src?.[locale] ?? null, localPath, locale),
    ];
  }

  localDescriptor(): MaybeOptDesc<ReturnType<T["localDescriptor"]>, Opt> {
    return maybeOptDesc(
      this.schema.localDescriptor() as ReturnType<T["localDescriptor"]>,
      this.opt
    );
  }

  rawDescriptor(): MaybeOptDesc<
    DetailedRecordDescriptor<ReturnType<T["rawDescriptor"]>>,
    Opt
  > {
    return maybeOptDesc(
      {
        type: "record",
        item: this.schema.rawDescriptor() as ReturnType<T["rawDescriptor"]>,
      },
      this.opt
    );
  }

  serialize(): SerializedI18nSchema {
    return {
      type: "i18n",
      schema: this.schema.serialize(),
      opt: this.opt,
    };
  }

  optional(): I18nSchema<T, true> {
    if (this.opt) console.warn("Schema is already optional");
    return new I18nSchema(this.schema, true);
  }

  static deserialize(
    schema: SerializedI18nSchema
  ): I18nSchema<Schema<Source, Source>, boolean> {
    return new I18nSchema(deserializeSchema(schema.schema), schema.opt);
  }
}
export const i18n = <T extends Schema<Source, Source>>(
  schema: T
): I18nSchema<T, false> => {
  return new I18nSchema(schema, false);
};
i18n.optional = <T extends Schema<Source, Source>>(
  schema: T
): I18nSchema<T, true> => {
  return new I18nSchema(schema, true);
};
