import { type SerializedArraySchema } from "./array";
import { type SerializedI18nSchema } from "./i18n";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";
import { Source } from "../Source";
import { SerializedNumberSchema } from "./number";
import { SerializedImageSchema } from "./image";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedNumberSchema
  | SerializedI18nSchema
  | SerializedObjectSchema
  | SerializedArraySchema
  | SerializedImageSchema;

export type SrcOf<T extends Schema<never, Source>> = [T] extends [
  Schema<infer Src, Source>
]
  ? Src
  : never;

export type LocalOf<T extends Schema<never, Source>> = T extends Schema<
  never,
  infer Local
>
  ? Local
  : Source;

/**
 * Makes a value of type {@link T} potentially optional based on {@link Opt}.
 * Unlike {@link OptOut}, OptIn defalts to non-null if the optionality is
 * unknown, making it suitable for function parameters.
 *
 * - If {@link Opt} is true, the value is T | null.
 * - If {@link Opt} is false or boolean (unknown), the value is T.
 */
export type OptIn<T extends Source, Opt extends boolean> = [Opt] extends [true]
  ? T | null
  : T;

/**
 * Makes a value of type {@link T} potentially optional based on {@link Opt}.
 * Unlike {@link OptIn}, OptOut defalts to nullable if the optionality is
 * unknown, making it suitable for function return values.
 *
 * - If {@link Opt} is true or boolean (unknown), the value is T | null.
 * - If {@link Opt} is false, the value is T.
 */
export type OptOut<T extends Source, Opt extends boolean> = [Opt] extends [true]
  ? T | null
  : T;

export abstract class Schema<in Src extends Source, out Local extends Source> {
  constructor(public readonly opt: boolean) {}

  /**
   * Validate a value against this schema
   *
   * @param src
   * @internal
   */
  protected abstract validate(src: Src): false | string[];

  /**
   * Check if this schema or any of its ancestors has i18n capabilities.
   *
   * @internal
   */
  abstract hasI18n(): boolean;

  protected abstract localize(src: Src, locale: "en_US"): Local;

  /**
   * Transforms a {@link Local} path to a {@link Src} path.
   * @param src The source value of the Schema.
   * @param localPath {@link Local} path.
   * @param locale The locale of localPath.
   */
  protected abstract delocalizePath(
    src: Src,
    localPath: string[],
    locale: "en_US"
  ): string[];

  abstract serialize(): SerializedSchema;

  static validate<S extends Schema<never, Source>>(
    schema: S,
    src: SrcOf<S>
  ): false | string[] {
    return (schema.validate as (this: S, src: SrcOf<S>) => false | string[])(
      src
    );
  }

  static localize<S extends Schema<never, Source>>(
    schema: S,
    src: SrcOf<S>,
    locale: "en_US"
  ): LocalOf<S> {
    return (
      schema.localize as (this: S, src: SrcOf<S>, locale: "en_US") => LocalOf<S>
    )(src, locale);
  }

  static delocalizePath<S extends Schema<never, Source>>(
    schema: S,
    src: SrcOf<S>,
    localPath: string[],
    locale: "en_US"
  ): string[] {
    return (
      schema.delocalizePath as (
        this: S,
        src: SrcOf<S>,
        localPath: string[],
        locale: "en_US"
      ) => string[]
    )(src, localPath, locale);
  }
}
