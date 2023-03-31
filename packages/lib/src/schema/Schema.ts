import { type SerializedArraySchema } from "./array";
import { type SerializedI18nSchema } from "./i18n";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";
import { Source } from "../Source";
import { SerializedNumberSchema } from "./number";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedNumberSchema
  | SerializedI18nSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export type SrcOf<T extends Schema<Source, Source>> = T extends Schema<
  infer Src,
  Source
>
  ? Src
  : Source;

export type LocalOf<T extends Schema<Source, Source>> = T extends Schema<
  Source,
  infer Out
>
  ? Out
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

export abstract class Schema<Src extends Source, Local extends Source> {
  constructor(public readonly opt: boolean) {}

  /**
   * Validate a value against this schema
   *
   * @param src
   * @internal
   */
  abstract validate(src: Src): false | string[];

  /**
   * Check if this schema or any of its ancestors has i18n capabilities.
   *
   * @internal
   */
  abstract hasI18n(): boolean;

  abstract localize(src: Src, locale: "en_US"): Local;

  /**
   * Transforms a {@link Local} path to a {@link Src} path.
   * @param src The source value of the Schema.
   * @param localPath {@link Local} path.
   * @param locale The locale of localPath.
   */
  // NOTE: src is currently unused, but may eventually be required for more
  // complex schemas
  abstract delocalizePath(
    src: Src | null,
    localPath: string[],
    locale: "en_US"
  ): string[];

  abstract serialize(): SerializedSchema;
}
