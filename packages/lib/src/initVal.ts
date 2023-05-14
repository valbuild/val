import { content } from "./module";
import { i18n, I18n } from "./source/i18n";
import { InitSchema, initSchema, InitSchemaLocalized } from "./initSchema";
import { A, F } from "ts-toolbelt";
import { SelectorOf } from "./selector";
import { Val } from "./val";
import { SelectorSource, GenericSelector } from "./selector";
import { JsonOfSource } from "./val";
import { fetchVal } from "./fetchVal";

const initLocalizedVal = <Locales extends string[]>(options: {
  readonly locales: {
    readonly required: F.Narrow<Locales>;
    readonly fallback: Locales[number];
  };
}) => {
  const s = initSchema(options.locales.required);
  return {
    val: {
      content,
      i18n,
    },
    s,
  };
};

const initNonLocalizedVal = (options?: { readonly locales?: undefined }) => {
  const s = initSchema([]);
  return {
    val: {
      content,
    },
    s: {
      ...s,
      i18n: undefined,
    },
  };
};

type ValConstructor = {
  content: typeof content;
};
export type InitVal<Locales extends readonly string[] | undefined> =
  Locales extends readonly string[]
    ? {
        val: ValConstructor & {
          i18n: I18n<Locales>;
        };
        fetchVal<T extends SelectorSource>(
          selector: T,
          locale: Locales[number]
        ): SelectorOf<T> extends GenericSelector<infer S>
          ? Promise<Val<JsonOfSource<S>>>
          : never;
        s: InitSchema & InitSchemaLocalized<Locales>;
      }
    : {
        val: ValConstructor;
        fetchVal<T extends SelectorSource>(
          selector: T
        ): SelectorOf<T> extends GenericSelector<infer S>
          ? Promise<Val<JsonOfSource<S>>>
          : never;
        s: InitSchema;
      };
export const initVal = <
  Locales extends readonly string[] | undefined
>(options: {
  readonly locales?: F.Narrow<{
    readonly required: Locales;
    readonly fallback: Locales extends readonly string[]
      ? Locales[number]
      : never;
  }>;
}): A.Compute<InitVal<Locales>> => {
  const { locales } = options;
  const s = initSchema(locales?.required as readonly string[]);
  if (locales?.required) {
    console.error("Locales / i18n currently not implemented");
    return {
      val: {
        content,
        i18n,
      },
      fetchVal: fetchVal,
      s,
    } as any;
  }
  return {
    val: {
      content,
    },
    fetchVal: fetchVal,
    s: {
      ...s,
      i18n: undefined,
    },
  } as any;
};
