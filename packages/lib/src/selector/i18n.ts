import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import { Selector } from "./selector";
import { I18nDescriptor, ValueOf } from "../lens/descriptor";

interface I18nSelectorMethods<Src, D extends I18nDescriptor> {
  localize(locale: "en_US"): SelectorOf<Src, D["desc"]>;
}

// TODO: How to get SelectorOf to work on this?
export type I18nSelector<Src, D extends I18nDescriptor> = Selector<
  Src,
  ValueOf<D["desc"]>
> &
  I18nSelectorMethods<Src, D>;

export function newI18nSelector<Src, D extends I18nDescriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>>,
  desc: D
): I18nSelector<Src, D> {
  const methods: I18nSelectorMethods<Src, D> = {
    localize(locale: "en_US"): SelectorOf<Src, D["desc"]> {
      const l = lens.compose(fromSrc, lens.localize<ValueOf<D>>(locale));
      return getSelector(l, desc.desc) as SelectorOf<Src, D["desc"]>;
    },
  };
  const l = lens.compose(fromSrc, lens.localize<ValueOf<D>>());
  return Object.create(getSelector(l, desc.desc), {
    localize: {
      value: methods.localize,
    },
  });
}
