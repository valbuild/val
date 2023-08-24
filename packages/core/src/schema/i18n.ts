/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { I18nCompatibleSource, I18nSource } from "../source/i18n";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedI18nSchema = {
  type: "i18n";
  locales: readonly string[];
  item: SerializedSchema;
  opt: boolean;
};

export class I18nSchema<Locales extends readonly string[]> extends Schema<
  I18nSource<Locales, SchemaTypeOf<Schema<I18nCompatibleSource>>>
> {
  constructor(
    readonly locales: Locales,
    readonly item: Schema<SchemaTypeOf<Schema<I18nCompatibleSource>>>,
    readonly opt: boolean = false
  ) {
    super();
  }

  validate(
    path: SourcePath,
    src: I18nSource<Locales, SchemaTypeOf<Schema<I18nCompatibleSource>>>
  ): ValidationErrors {
    throw new Error("Method not implemented.");
  }

  assert(
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
      locales: this.locales,
      opt: this.opt,
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
    return new I18nSchema(locales, schema);
  };
