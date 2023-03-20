import { deserializeSchema } from "./schema/serialization";
import * as expr from "./expr";
import { Schema, SerializedSchema, SrcOf } from "./schema/Schema";
import { getSelector, SelectorOf } from "./selector";
import { EXPR, Selector } from "./selector/selector";
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

  select<Out>(
    callback: <Ctx>(
      selector: SelectorOf<Ctx, ReturnType<T["localDescriptor"]>>
    ) => Selector<Ctx, Out>,
    locale: "en_US" = "en_US"
  ): Out {
    const ctx = [this.schema.localize(this.source, locale)] as const;
    const rootExpr = expr.fromCtx(0);
    const rootSelector = getSelector(
      rootExpr,
      this.schema.localDescriptor()
    ) as SelectorOf<typeof ctx, ReturnType<T["localDescriptor"]>>;
    const result = callback(rootSelector)[EXPR]();
    return result.evaluate(ctx);
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
