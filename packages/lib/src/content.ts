import { deserializeSchema } from "./schema/serialization";
import * as expr from "./expr";
import { Schema, SerializedSchema, SourceOf } from "./schema/Schema";
import { getSelector, SelectorOf } from "./selector";
import { EXPR, Selector } from "./selector/selector";
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
    callback: <Ctx>(
      selector: SelectorOf<Ctx, ReturnType<T["descriptor"]>>
    ) => Selector<Ctx, Out>
  ): Out {
    const ctx = {
      [expr.MOD]: this.source,
    } as const;
    const rootExpr: expr.Expr<typeof ctx, Source> = expr.mod;
    const rootSelector = getSelector(
      rootExpr,
      this.schema.descriptor()
    ) as SelectorOf<{ [expr.MOD]: Source }, ReturnType<T["descriptor"]>>;
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
  }: SerializedModuleContent): ModuleContent<Schema<Source>> {
    return new ModuleContent(source, deserializeSchema(schema));
  }
}

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
};
