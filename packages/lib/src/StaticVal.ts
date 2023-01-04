import { Schema } from "./schema/Schema";
import { SerializedSchema } from "./schema/SerializedSchema";
import { ValidTypes } from "./ValidTypes";

/**
 * @deprecated Uncertain about the name of this
 */
export class StaticVal<T extends ValidTypes> {
  constructor(private readonly val: T, public readonly schema: Schema<T>) {}

  /**
   * Get the value of this static value
   *
   * @internal
   */
  get(): T {
    return this.val;
  }

  serialize(): { val: T; schema: SerializedSchema } {
    return {
      val: this.val,
      schema: this.schema.serialize(),
    };
  }
}
