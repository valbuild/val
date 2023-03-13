import { ModuleContent } from "../content";
import { Source } from "../Source";
import { type SerializedArraySchema } from "./array";
import { type SerializedObjectSchema } from "./object";
import { type SerializedStringSchema } from "./string";

export type SerializedSchema =
  | SerializedStringSchema
  | SerializedObjectSchema
  | SerializedArraySchema;

export abstract class Schema<T extends Source> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: T): false | string[];

  fixed(val: T): ModuleContent<T> {
    return new ModuleContent(val, this);
  }

  abstract serialize(): SerializedSchema;
}
