import * as exprN from "../expr";
import { getSelector, SelectorOf } from ".";
import { Descriptor, ValueOf } from "../descriptor";

interface I18nSelectorMethods<Ctx, D extends Descriptor> {
  localize(locale: "en_US"): SelectorOf<Ctx, D>;
}

export type I18nSelector<Ctx, D extends Descriptor> = SelectorOf<Ctx, D> &
  I18nSelectorMethods<Ctx, D>;

export function newI18nSelector<Ctx, D extends Descriptor>(
  expr: exprN.Expr<Ctx, Record<"en_US", ValueOf<D>>>,
  desc: D
): I18nSelector<Ctx, D> {
  const methods: I18nSelectorMethods<Ctx, D> = {
    localize(locale: "en_US"): SelectorOf<Ctx, D> {
      return getSelector(exprN.localize(expr, locale), desc);
    },
  };
  const l = exprN.localize(expr);
  return Object.create(getSelector(l, desc), {
    localize: {
      value: methods.localize,
    },
  });
}
