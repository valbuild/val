import { deserializeSchema } from "./schema/serialization";
import * as expr from "./expr";
import { localDescriptorOf, LocalDescriptorOf } from "./schema";
import { OutOf, Schema, SerializedSchema, SrcOf } from "./schema/Schema";
import { exprOf, ExprOf, getSelector, Selected, SelectorOf } from "./selector";
import { Source } from "./Source";

export class ModuleContent<T extends Schema<never, Source>> {
  constructor(
    /**
     * @internal
     */
    public readonly source: SrcOf<T>,
    public readonly schema: T
  ) {}

  validate(): false | string[] {
    return Schema.validate(this.schema, this.source);
  }

  select<S extends Selected<readonly [OutOf<T>]>>(
    callback: (
      selector: SelectorOf<LocalDescriptorOf<T>, readonly [OutOf<T>]>
    ) => S
  ): ExprOf<S, readonly [OutOf<T>]> {
    const rootExpr = expr.fromCtx<readonly [OutOf<T>], 0>(0);
    const rootSelector = getSelector(
      rootExpr,
      localDescriptorOf(this.schema)
    ) as SelectorOf<LocalDescriptorOf<T>, readonly [OutOf<T>]>;
    return exprOf(callback(rootSelector));
  }

  localize(locale: "en_US"): OutOf<T> {
    return Schema.transform(this.schema, this.source, locale);
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
  }: SerializedModuleContent): ModuleContent<Schema<never, Source>> {
    return new ModuleContent(source as never, deserializeSchema(schema));
  }
}

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
};
