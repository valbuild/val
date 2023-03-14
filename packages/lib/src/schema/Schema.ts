import { type SerializedArraySchema } from "./array";
import { type SerializedI18nSchema } from "./i18n";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";
import { Source } from "../Source";
import { Descriptor } from "../lens/descriptor";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedI18nSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export type SourceOf<T extends Schema<Source>> = T extends Schema<infer Src>
  ? Src
  : Source;

export abstract class Schema<Src extends Source> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: Src): false | string[];

  abstract descriptor(): Descriptor;

  abstract serialize(): SerializedSchema;
}
