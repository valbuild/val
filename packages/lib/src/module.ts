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
  implements Selectable<LocalOf<T>>
{
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}

  getVal(locale: "en_US"): Val<LocalOf<T>> {
    const rootExpr = expr.fromCtx<readonly [LocalOf<T>], 0>(0);
    return newVal(
      encodeValSrc(this.id, locale, rootExpr),
      this.content.localize(locale)
    );
  }

  select<Out>(
    callback: <Ctx>(
      selector: SelectorOf<Ctx, ReturnType<T["localDescriptor"]>>
    ) => Selector<Ctx, Out>
  ): Selectable<Out> {
    const resultExpr = this.content.select(callback);
    return {
      getVal: (locale) => {
        return newVal(
          encodeValSrc(this.id, locale, resultExpr),
          resultExpr.evaluate([this.content.localize(locale)])
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
