import { deserializeSchema } from "./schema/serialization";
import * as lens from "./lens";
import { ValueOf } from "./lens/descriptor";
import { Schema, SerializedSchema } from "./schema/Schema";
import { getSelector, SelectorOf } from "./selector";
import { LENS, Selector } from "./selector/selector";
import { Source } from "./Source";

export class ModuleContent<T extends Schema<Source, unknown>> {
  constructor(
    /**
     * @internal
     */
    public readonly source: lens.InOf<T>,
    public readonly schema: T
  ) {}

  validate() {
    return this.schema.validate(this.source);
  }

  select<Out>(
    callback: <Src>(
      selector: SelectorOf<Src, ReturnType<T["descriptor"]>>
    ) => Selector<Src, Out>
  ): Out {
    const rootSelector = getSelector(
      lens.identity(),
      this.schema.descriptor()
    ) as SelectorOf<
      ValueOf<ReturnType<T["descriptor"]>>,
      ReturnType<T["descriptor"]>
    >;
    const l = lens.compose(this.schema, callback(rootSelector)[LENS]());
    return l.apply(this.source);
  }

  /**
   * Get the source of this module
   *
   * @internal
   */
  get(): lens.OutOf<T> {
    return this.schema.apply(this.source) as lens.OutOf<T>;
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
