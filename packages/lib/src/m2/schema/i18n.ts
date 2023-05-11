import { Schema, SchemaTypeOf } from ".";
import { I18nCompatibleSource, I18nSource } from "../Source";

export const i18n =
  <Locales extends string[]>(locales: Locales) =>
  <S extends Schema<I18nCompatibleSource>>(
    schema: S
  ): Schema<I18nSource<Locales, SchemaTypeOf<S>>> => {
    throw Error("unimplemented");
  };
