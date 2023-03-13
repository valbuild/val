import { type SerializedArraySchema } from "./array";
import { type SerializedI18nSchema } from "./i18n";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";
import { Lens } from "../lens";
import { Source } from "../Source";
import { Descriptor } from "../lens/descriptor";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedI18nSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export abstract class Schema<In extends Source, Out> implements Lens<In, Out> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: In): false | string[];

  abstract apply(input: In): Out;

  abstract descriptor(): Descriptor;

  abstract serialize(): SerializedSchema;
}
