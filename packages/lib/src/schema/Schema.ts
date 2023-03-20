import { Source } from "../Source";
import { type SerializedArraySchema } from "./array";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export type SrcOf<T extends Schema<Source>> = T extends Schema<infer U>
  ? U
  : never;

export abstract class Schema<T extends Source> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: T): false | string[];

  abstract serialize(): SerializedSchema;
}
