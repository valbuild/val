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

export type SerializedI18nSchema = {
  type: "i18n";
  schema: SerializedSchema;
  opt: boolean;
};

export class I18nSchema<
  T extends Schema<never, Source>,
  Opt extends boolean
> extends Schema<
  OptIn<{ readonly en_US: SrcOf<T> }, Opt>,
  OptOut<LocalOf<T>, Opt>
> {
  constructor(public readonly schema: T, public readonly opt: Opt) {
    super(opt);

    if (schema.hasI18n()) {
      console.warn("Nested i18n detected.");
    }
  }
  protected validate(
    src: OptIn<{ readonly en_US: SrcOf<T> }, Opt>
  ): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Required i18n record cannot be null"];
      return false;
    }
    const errors: string[] = [];
    for (const key in src) {
      const value = src[key as "en_US"];
      const result = Schema.validate(this.schema, value);
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

  protected localize(
    src: OptIn<{ readonly en_US: SrcOf<T> }, Opt>,
    locale: "en_US"
  ): OptOut<LocalOf<T>, Opt> {
    if (src === null) {
      if (!this.opt) throw Error("Required i18n record cannot be null");
      return null as OptOut<LocalOf<T>, Opt>;
    }
    return Schema.localize(this.schema, src[locale], locale);
  }

  protected delocalizePath(
    src: OptIn<{ readonly en_US: SrcOf<T> }, Opt>,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    if (src === null) {
      if (!this.opt) {
        throw Error("Invalid value: Required i18n record cannot be null");
      }

      if (localPath.length !== 0) {
        throw Error(
          "Invalid path: Cannot access item of i18n record whose value is null"
        );
      }

      return localPath;
    }
    return [
      locale,
      ...Schema.delocalizePath(this.schema, src[locale], localPath, locale),
    ];
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
  ): I18nSchema<Schema<never, Source>, boolean> {
    return new I18nSchema(deserializeSchema(schema.schema), schema.opt);
  }
}
export const i18n = <T extends Schema<never, Source>>(
  schema: T
): I18nSchema<T, false> => {
  return new I18nSchema(schema, false);
};
i18n.optional = <T extends Schema<never, Source>>(
  schema: T
): I18nSchema<T, true> => {
  return new I18nSchema(schema, true);
};
