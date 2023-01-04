import { StaticVal } from "../StaticVal";
import { ValidTypes } from "../ValidTypes";
import { SerializedSchema } from "./SerializedSchema";

export abstract class Schema<T extends ValidTypes> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: T): false | string[];

  static(val: T): StaticVal<T> {
    return new StaticVal(val, this);
  }

  abstract serialize(): SerializedSchema;
}
