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

  // NOTE: src is currently unused in localizePath, but may eventually be
  // required for more complex schemas
  abstract localizePath(src: Src, path: string[], locale: "en_US"): string[];

  abstract localDescriptor(): Descriptor;

  abstract rawDescriptor(): Descriptor;

  abstract serialize(): SerializedSchema;
}
