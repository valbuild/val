import * as expr from "./expr";
import { ModuleContent } from "./content";
import { LocalDescriptorOf } from "./schema";
import { LocalOf, Schema, SrcOf } from "./schema/Schema";
import { DescriptorOf, Selected, SelectorOf } from "./selector";
import { newVal, Val } from "./Val";
import { encodeValSrc } from "./expr/strings";
import { Selectable } from "./selectable";
import { ValueOf } from "./descriptor";
import { Source } from "./Source";

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

  select<S extends Selected<readonly [LocalOf<T>]>>(
    callback: (
      selector: SelectorOf<readonly [LocalOf<T>], LocalDescriptorOf<T>>
    ) => S
  ): Selectable<SrcOf<T>, ValueOf<DescriptorOf<readonly [LocalOf<T>], S>>> {
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
