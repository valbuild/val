import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { I18nCompatibleSource, I18nSource } from "../source/i18n";
import { SourcePath } from "../val";

export type SerializedI18nSchema = {
  type: "i18n";
  item: SerializedSchema;
};

class I18nSchema<Locales extends readonly string[]> extends Schema<
  I18nSource<Locales, SchemaTypeOf<Schema<I18nCompatibleSource>>>
> {
  constructor(
    readonly locales: Locales,
    readonly item: Schema<SchemaTypeOf<Schema<I18nCompatibleSource>>>,
    readonly isOptional: boolean = false
  ) {
    super();
  }

  validate(
    src: I18nSource<Locales, SchemaTypeOf<Schema<I18nCompatibleSource>>>
  ): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(
    src: I18nSource<Locales, SchemaTypeOf<Schema<I18nCompatibleSource>>>
  ): boolean {
    throw new Error("Method not implemented.");
  }

  optional(): Schema<I18nSource<
    Locales,
    SchemaTypeOf<Schema<I18nCompatibleSource>>
  > | null> {
    return new I18nSchema(this.locales, this.item, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "i18n",
      item: this.item.serialize(),
    };
  }
}

export type I18n<Locales extends readonly string[]> = <
  S extends Schema<I18nCompatibleSource>
>(
  schema: S
) => Schema<I18nSource<Locales, SchemaTypeOf<S>>>;

export const i18n =
  <Locales extends readonly string[]>(locales: Locales) =>
  <S extends Schema<I18nCompatibleSource>>(
    schema: S
  ): Schema<I18nSource<Locales, SchemaTypeOf<S>>> => {
    throw Error("unimplemented");
  };
