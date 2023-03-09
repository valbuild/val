import { StaticVal } from "../StaticVal";
import { ValidTypes } from "../ValidTypes";
import { type SerializedArraySchema } from "./array";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export abstract class Schema<T extends ValidTypes> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: T): false | string[];

  fixed(val: T): StaticVal<T> {
    return new StaticVal(val, this);
  }

  abstract serialize(): SerializedSchema;
}
