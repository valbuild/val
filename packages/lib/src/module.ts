import * as expr from "./expr";
import { ModuleContent } from "./content";
import { Schema, SourceOf } from "./schema/Schema";
import { getSelector, SelectorOf } from "./selector";
import { EXPR, Selector } from "./selector/selector";
import { Source } from "./Source";
import { newVal, Val } from "./Val";

export class ValModule<T extends Schema<Source>> {
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}

  select<Out>(
    callback: <Ctx>(
      selector: SelectorOf<Ctx, ReturnType<T["descriptor"]>>
    ) => Selector<Ctx, Out>
  ): Val<Out> {
    type Ctx = {
      readonly [expr.MOD]: Source;
    };
    const ctx: Ctx = {
      [expr.MOD]: this.content.source,
    };
    const rootExpr: expr.Expr<Ctx, Source> = expr.mod;
    const rootSelector = getSelector(
      rootExpr,
      this.content.schema.descriptor()
    ) as SelectorOf<{ [expr.MOD]: Source }, ReturnType<T["descriptor"]>>;
    const result = callback(rootSelector)[EXPR]();
    return newVal(result.toString({ [expr.MOD]: "" }), result.evaluate(ctx));
  }
}

/**
 *
 * @deprecated Uncertain about the name of this
 */
export const content = <T extends Schema<Source>>(
  id: string,
  schema: T,
  src: SourceOf<T>
): ValModule<T> => {
  return new ValModule(id, new ModuleContent(src, schema));
};
