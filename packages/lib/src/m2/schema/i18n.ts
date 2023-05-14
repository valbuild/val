import { Schema, SchemaTypeOf } from ".";
import { I18nCompatibleSource, I18nSource } from "../source";

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
