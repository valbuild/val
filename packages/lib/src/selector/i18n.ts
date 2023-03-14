import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import { Descriptor, ValueOf } from "../lens/descriptor";

interface I18nSelectorMethods<Src, D extends Descriptor> {
  localize(locale: "en_US"): SelectorOf<Src, D>;
}

export type I18nSelector<Src, D extends Descriptor> = SelectorOf<Src, D> &
  I18nSelectorMethods<Src, D>;

export function newI18nSelector<Src, D extends Descriptor>(
  fromSrc: lens.Lens<Src, Record<"en_US", ValueOf<D>>>,
  desc: D
): I18nSelector<Src, D> {
  const methods: I18nSelectorMethods<Src, D> = {
    localize(locale: "en_US"): SelectorOf<Src, D> {
      const l = lens.compose(fromSrc, lens.localize<ValueOf<D>>(locale));
      return getSelector(l, desc);
    },
  };
  const l = lens.compose(fromSrc, lens.localize<ValueOf<D>>());
  return Object.create(getSelector(l, desc), {
    localize: {
      value: methods.localize,
    },
  });
}
