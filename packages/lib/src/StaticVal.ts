import { Schema, SerializedSchema } from "./schema/Schema";
import { Source } from "./Source";

/**
 * @deprecated Uncertain about the name of this
 */
export class StaticVal<T extends Source> {
  constructor(private readonly val: T, public readonly schema: Schema<T>) {}

  /**
   * Get the value of this static value
   *
   * @internal
   */
  get(): T {
    return this.val;
  }

  serialize(): SerializedVal {
    return {
      val: this.val,
      schema: this.schema.serialize(),
    };
  }
}

export type SerializedVal = {
  val: Source;
  schema: SerializedSchema;
};
