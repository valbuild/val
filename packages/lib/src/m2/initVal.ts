import { content } from "./module";
import { i18n, I18n } from "./Source";
import { InitSchema, initSchema, InitSchemaLocalized } from "./initSchema";
import { A, F } from "ts-toolbelt";

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
type InitVal<Locales extends readonly string[] | undefined> =
  Locales extends readonly string[]
    ? {
        val: ValConstructor & {
          i18n: I18n<Locales>;
        };
        s: InitSchema & InitSchemaLocalized<Locales>;
      }
    : {
        val: ValConstructor;
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
    return {
      val: {
        content,
        i18n,
      },
      s,
    } as any;
  }
  return {
    val: {
      content,
    },
    s: {
      ...s,
      i18n: undefined,
    },
  } as any;
};
