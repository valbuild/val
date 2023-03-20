import { DetailedRecordDescriptor } from "../descriptor";
import { Source } from "../Source";
import { LocalOf, Schema, SrcOf, type SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";

export type SerializedI18nSchema = {
  type: "i18n";
  schema: SerializedSchema;
};

export class I18nSchema<T extends Schema<Source, Source>> extends Schema<
  Record<"en_US", SrcOf<T>>,
  LocalOf<T>
> {
  constructor(private readonly schema: T) {
    super();

    if (schema.hasI18n()) {
      console.warn("Nested i18n detected. ");
    }
  }
  validate(input: Record<"en_US", SrcOf<T>>): false | string[] {
    const errors: string[] = [];
    for (const key in input) {
      const value = input[key as "en_US"];
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

  localize(src: Record<"en_US", SrcOf<T>>, locale: "en_US"): LocalOf<T> {
    return this.schema.localize(src[locale], locale) as LocalOf<T>;
  }

  localizePath(
    src: Record<"en_US", SrcOf<T>>,
    path: string[],
    locale: "en_US"
  ): string[] {
    return [locale, ...this.schema.localizePath(src[locale], path, locale)];
  }

  localDescriptor(): ReturnType<T["rawDescriptor"]> {
    return this.schema.localDescriptor() as ReturnType<T["localDescriptor"]>;
  }

  rawDescriptor(): DetailedRecordDescriptor<ReturnType<T["rawDescriptor"]>> {
    return {
      type: "record",
      item: this.schema.rawDescriptor(),
    };
  }

  serialize(): SerializedI18nSchema {
    return {
      type: "i18n",
      schema: this.schema.serialize(),
    };
  }

  static deserialize(
    schema: SerializedI18nSchema
  ): I18nSchema<Schema<Source, Source>> {
    return new I18nSchema(deserializeSchema(schema.schema));
  }
}
export const i18n = <T extends Schema<Source, Source>>(
  schema: T
): I18nSchema<T> => {
  return new I18nSchema(schema);
};
