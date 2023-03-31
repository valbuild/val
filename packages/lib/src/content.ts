import { deserializeSchema } from "./schema/serialization";
import * as expr from "./expr";
import { localDescriptorOf, LocalDescriptorOf } from "./schema";
import { LocalOf, Schema, SerializedSchema, SrcOf } from "./schema/Schema";
import { exprOf, ExprOf, getSelector, Selected, SelectorOf } from "./selector";
import { Source } from "./Source";

export class ModuleContent<T extends Schema<Source, Source>> {
  constructor(
    /**
     * @internal
     */
    public readonly source: SrcOf<T>,
    public readonly schema: T
  ) {}

  validate(): false | string[] {
    return this.schema.validate(this.source);
  }

  select<S extends Selected<readonly [LocalOf<T>]>>(
    callback: (
      selector: SelectorOf<readonly [LocalOf<T>], LocalDescriptorOf<T>>
    ) => S
  ): ExprOf<readonly [LocalOf<T>], S> {
    const rootExpr = expr.fromCtx<readonly [LocalOf<T>], 0>(0);
    const rootSelector = getSelector(
      rootExpr,
      localDescriptorOf(this.schema)
    ) as SelectorOf<readonly [LocalOf<T>], LocalDescriptorOf<T>>;
    return exprOf(callback(rootSelector));
  }

  localize(locale: "en_US"): LocalOf<T> {
    return this.schema.localize(this.source, locale) as LocalOf<T>;
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
  }: SerializedModuleContent): ModuleContent<Schema<Source, Source>> {
    return new ModuleContent(source, deserializeSchema(schema));
  }
}

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
};
