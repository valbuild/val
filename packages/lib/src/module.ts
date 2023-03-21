import * as expr from "./expr";
import { ModuleContent } from "./content";
import { Schema, SrcOf } from "./schema/Schema";
import { getSelector, SelectorOf } from "./selector";
import { EXPR, Selector } from "./selector/selector";
import { Source } from "./Source";
import { newVal, Val } from "./Val";
import { encodeValSrc } from "./expr/strings";

export class ValModule<T extends Schema<Source, Source>> {
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}

  select<Out>(
    callback: <Ctx>(
      selector: SelectorOf<Ctx, ReturnType<T["localDescriptor"]>>
    ) => Selector<Ctx, Out>,
    locale: "en_US" = "en_US"
  ): Val<Out> {
    const ctx = [
      this.content.schema.localize(this.content.source, locale),
    ] as const;
    const rootExpr = expr.fromCtx<typeof ctx, 0>(0);
    const rootSelector = getSelector(
      rootExpr,
      this.content.schema.localDescriptor()
    ) as SelectorOf<typeof ctx, ReturnType<T["localDescriptor"]>>;
    const result = callback(rootSelector)[EXPR]();
    return newVal(encodeValSrc(this.id, locale, result), result.evaluate(ctx));
  }
}

/**
 *
 * @deprecated Uncertain about the name of this
 */
export const content = <T extends Schema<Source, Source>>(
  id: string,
  schema: T,
  src: SrcOf<T>
): ValModule<T> => {
  return new ValModule(id, new ModuleContent(src, schema));
};
