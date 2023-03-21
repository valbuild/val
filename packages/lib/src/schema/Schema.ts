import { type SerializedArraySchema } from "./array";
import { type SerializedI18nSchema } from "./i18n";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";
import { Source } from "../Source";
import { Descriptor } from "../descriptor";
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

export abstract class Schema<Src extends Source, Local extends Source> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: Src): false | string[];

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
    src: Src,
    localPath: string[],
    locale: "en_US"
  ): string[];

  abstract localDescriptor(): Descriptor;

  abstract rawDescriptor(): Descriptor;

  abstract serialize(): SerializedSchema;
}
