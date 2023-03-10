import { InOf, OutOf } from "./lens";
import { type Schema, SerializedSchema } from "./schema/Schema";
import { deserializeSchema } from "./schema/serialization";
import { Source } from "./Source";

export class ModuleContent<T extends Schema<Source, unknown>> {
  constructor(
    /**
     * @internal
     */
    public readonly source: InOf<T>,
    public readonly schema: T
  ) {}

  validate() {
    return this.schema.validate(this.source);
  }

  /**
   * Get the source of this module
   *
   * @internal
   */
  get(): OutOf<T> {
    return this.schema.apply(this.source) as OutOf<T>;
  }

  serialize(): SerializedModuleContent {
    return {
      source: this.source,
      schema: this.schema.serialize(),
    };
  }

  static deserialize({
    source,
    schema,
  }: SerializedModuleContent): ModuleContent<Schema<Source, unknown>> {
    return new ModuleContent(source, deserializeSchema(schema));
  }
}

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
};
