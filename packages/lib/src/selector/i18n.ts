import * as op from "../op";
import { getSelector, SelectorOf } from ".";
import { Descriptor, ValueOf } from "../descriptor";

interface I18nSelectorMethods<Src, D extends Descriptor> {
  localize(locale: "en_US"): SelectorOf<Src, D>;
}

export type I18nSelector<Src, D extends Descriptor> = SelectorOf<Src, D> &
  I18nSelectorMethods<Src, D>;

export function newI18nSelector<Src, D extends Descriptor>(
  fromSrc: op.Op<Src, Record<"en_US", ValueOf<D>>>,
  desc: D
): I18nSelector<Src, D> {
  const methods: I18nSelectorMethods<Src, D> = {
    localize(locale: "en_US"): SelectorOf<Src, D> {
      const l = op.compose(fromSrc, op.localize<ValueOf<D>>(locale));
      return getSelector(l, desc);
    },
  };
  const l = op.compose(fromSrc, op.localize<ValueOf<D>>());
  return Object.create(getSelector(l, desc), {
    localize: {
      value: methods.localize,
    },
  });
}
