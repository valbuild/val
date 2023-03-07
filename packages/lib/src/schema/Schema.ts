import { type SerializedArraySchema } from "./array";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";
import { Source } from "../Source";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export type InOf<T> = T extends Schema<infer In, unknown> ? In : never;
export type OutOf<T> = T extends Schema<Source, infer Out> ? Out : never;

export abstract class Schema<In extends Source, Out = In> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: In): false | string[];

  abstract apply(input: In): Out;

  abstract serialize(): SerializedSchema;
}
