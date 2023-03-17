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
    const ctx = [this.content.source] as const;
    const rootExpr = expr.fromCtx<typeof ctx, 0>(0);
    const rootSelector = getSelector(
      rootExpr,
      this.content.schema.descriptor()
    ) as SelectorOf<typeof ctx, ReturnType<T["descriptor"]>>;
    const result = callback(rootSelector)[EXPR]();
    return newVal(`${this.id}?${result.toString([""])}`, result.evaluate(ctx));
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
