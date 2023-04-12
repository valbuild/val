import * as expr from "./expr";
import { ModuleContent } from "./content";
import { LocalDescriptorOf } from "./schema";
import { LocalOf, Schema, SrcOf } from "./schema/Schema";
import { DescriptorOf, Selected, SelectorOf } from "./selector";
import { newVal, Val } from "./val";
import { encodeValSrc } from "./expr/strings";
import { Selectable } from "./selectable";
import { ValueOf } from "./descriptor";
import { Source } from "./Source";

export class ValModule<T extends Schema<never, Source>>
  implements Selectable<SrcOf<T>, LocalOf<T>>
{
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}

  getModule(): ValModule<Schema<SrcOf<T>, Source>> {
    // TODO: Is this type assertion actually OK?
    return this as unknown as ValModule<Schema<SrcOf<T>, Source>>;
  }

  getVal(source: SrcOf<T>, locale: "en_US"): Val<LocalOf<T>> {
    const rootExpr = expr.fromCtx<readonly [LocalOf<T>], 0>(0);
    return newVal(
      encodeValSrc(this.id, locale, rootExpr),
      Schema.localize(this.content.schema, source, locale)
    );
  }

  select<S extends Selected<readonly [LocalOf<T>]>>(
    callback: (
      selector: SelectorOf<LocalDescriptorOf<T>, readonly [LocalOf<T>]>
    ) => S
  ): Selectable<SrcOf<T>, ValueOf<DescriptorOf<S, readonly [LocalOf<T>]>>> {
    const resultExpr = this.content.select(callback);
    return {
      getModule: (): ValModule<Schema<SrcOf<T>, Source>> => {
        return this.getModule();
      },
      getVal: (source, locale) => {
        return newVal(
          encodeValSrc(this.id, locale, resultExpr),
          resultExpr.evaluate([
            Schema.localize(this.content.schema, source, locale),
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
export const content = <T extends Schema<never, Source>>(
  id: string,
  schema: T,
  src: SrcOf<T>
): ValModule<T> => {
  return new ValModule(id, new ModuleContent(src, schema));
};
