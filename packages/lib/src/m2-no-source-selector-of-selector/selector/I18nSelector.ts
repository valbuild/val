import { Selectors, SelectorExtensionBrand } from "./Selector";

/// I18n

export const I18n = Symbol("I18n");
export type Selector<
  Locales extends readonly string[],
  S extends Selectors
> = S & {
  all(): {
    [locale in Locales[number]]: S;
  };
  readonly [SelectorExtensionBrand]: "i18n";
};
