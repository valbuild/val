import type { F } from "ts-toolbelt";
import { SourcePrimitive, VAL_EXTENSION } from "..";
import { FileSource } from "../file";

/**
 * I18n sources cannot have nested remote sources.
 */
export type I18nCompatibleSource =
  | SourcePrimitive
  | I18nObject
  | I18nArray
  | FileSource;
export type I18nObject = { [key in string]: I18nCompatibleSource };
export type I18nArray = readonly I18nCompatibleSource[];

/**
 * An i18n source is a map of locales to sources.
 *
 * Its selector will default to the underlying source. It is possible to call `.all` on i18n sources, which returns an object with all the locales
 *
 */
export type I18nSource<
  Locales extends readonly string[],
  T extends I18nCompatibleSource
> = {
  readonly [locale in Locales[number]]: T;
} & {
  readonly [VAL_EXTENSION]: "i18n";
};

export type I18n<Locales extends readonly string[]> = <
  Src extends I18nCompatibleSource
>(source: {
  [locale in Locales[number]]: Src;
}) => I18nSource<Locales, Src>;
export function i18n<Locales extends readonly string[]>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  locales: F.Narrow<Locales>
): <Src extends I18nCompatibleSource>(source: {
  [locale in Locales[number]]: Src;
}) => I18nSource<Locales, Src> {
  return (source) => {
    return {
      ...source,
      [VAL_EXTENSION]: "i18n",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as I18nSource<Locales, any>;
  };
}

export function isI18n(
  obj: unknown
): obj is I18nSource<string[], I18nCompatibleSource> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    VAL_EXTENSION in obj &&
    obj[VAL_EXTENSION] === "i18n"
  );
}
