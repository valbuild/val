import { deserializeSchema } from "./schema/serialization";
import * as lens from "./lens";
import { Schema, SerializedSchema, SourceOf } from "./schema/Schema";
import { getSelector, SelectorOf } from "./selector";
import { LENS, Selector } from "./selector/selector";
import { Source } from "./Source";

export class ModuleContent<T extends Schema<Source>> {
  constructor(
    /**
     * @internal
     */
    public readonly source: SourceOf<T>,
    public readonly schema: T
  ) {}

  validate(): false | string[] {
    return this.schema.validate(this.source);
  }

  select<Out>(
    callback: <Src>(
      selector: SelectorOf<Src, ReturnType<T["descriptor"]>>
    ) => Selector<Src, Out>
  ): Out {
    const rootSelector = getSelector(
      lens.identity<SourceOf<T>>(),
      this.schema.descriptor()
    );
    const l = callback(
      rootSelector as SelectorOf<unknown, ReturnType<T["descriptor"]>>
    )[LENS]();
    return l.apply(this.source);
  }

  /**
   * Get the source of this module
   *
   * @internal
   */
  get(): Source {
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
  }: SerializedModuleContent): ModuleContent<Schema<Source>> {
    return new ModuleContent(source, deserializeSchema(schema));
  }
}

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
};
