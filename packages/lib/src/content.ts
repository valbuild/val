import { type Schema, SerializedSchema } from "./schema/Schema";
import { deserializeSchema } from "./schema/serialization";
import { Source } from "./Source";

export class ModuleContent<T extends Source> {
  constructor(private readonly source: T, public readonly schema: Schema<T>) {}

  /**
   * Get the source of this module
   *
   * @internal
   */
  get(): T {
    return this.source;
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
  }: SerializedModuleContent): ModuleContent<Source> {
    return new ModuleContent(source, deserializeSchema(schema));
  }
}

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
};
