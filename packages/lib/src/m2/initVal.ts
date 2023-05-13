import { content } from "./module";
import { i18n as initI18n } from "./schema/i18n";
import { initSchema } from "./initSchema";
import { F, I } from "ts-toolbelt";

const initLocalizedVal = <Locales extends string[]>(options: {
  readonly locales: {
    readonly required: F.Narrow<Locales>;
    readonly fallback: Locales[number];
  };
}) => {
  const s = initSchema(options.locales.required);
  const i18n = initI18n(options.locales.required);
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

type InitVal<Locales extends string[] | undefined> = {
  val: {};
  s: {};
};
export const initVal = <Locales extends string[] | undefined>(options: {
  readonly locales?: Locales extends string[]
    ? {
        readonly required: F.Narrow<Locales>;
        readonly fallback: Locales[number];
      }
    : undefined;
}): InitVal<Locales> => {
  if (options.locales) {
    return initLocalizedVal(options as any) as any;
  }
  return initNonLocalizedVal(options as any) as any;
};

const { val, s } = initVal({
  //  ^?
  locales: { required: ["en_US", "no_NB"], fallback: "en_US" },
});

// const a = s.i18n(s.string());
