import * as expr from "./expr";
import { ModuleContent } from "./content";
import { LocalOf, Schema, SrcOf } from "./schema/Schema";
import { SelectorOf } from "./selector";
import { Selector } from "./selector/selector";
import { Source } from "./Source";
import { newVal, Val } from "./Val";
import { encodeValSrc } from "./expr/strings";
import { Selectable } from "./selectable";

export class ValModule<T extends Schema<Source, Source>>
  implements Selectable<SrcOf<T>, LocalOf<T>>
{
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}

  getModule(): ValModule<Schema<SrcOf<T>, LocalOf<T>>> {
    return this as unknown as ValModule<Schema<SrcOf<T>, LocalOf<T>>>;
  }

  getVal(source: SrcOf<T>, locale: "en_US"): Val<LocalOf<T>> {
    const rootExpr = expr.fromCtx<readonly [LocalOf<T>], 0>(0);
    return newVal(
      encodeValSrc(this.id, locale, rootExpr),
      this.content.schema.localize(source, locale) as LocalOf<T>
    );
  }

  select<Out>(
    callback: <Ctx>(
      selector: SelectorOf<Ctx, ReturnType<T["localDescriptor"]>>
    ) => Selector<Ctx, Out>
  ): Selectable<SrcOf<T>, Out> {
    const resultExpr = this.content.select(callback);
    return {
      getModule: () => {
        return this;
      },
      getVal: (source, locale) => {
        return newVal(
          encodeValSrc(this.id, locale, resultExpr),
          resultExpr.evaluate([
            this.content.schema.localize(source, locale) as LocalOf<T>,
          ])
        );
      },
    };
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
