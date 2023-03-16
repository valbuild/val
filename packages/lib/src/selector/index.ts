import * as expr from "../expr";
import { ArraySelector, newArraySelector } from "./array";
import { PrimitiveSelector } from "./primitive";
import { newObjectSelector, ObjectSelector } from "./object";
import { Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  I18nDescriptor,
  NumberDescriptor,
  ObjectDescriptor,
  ObjectDescriptorProps,
  ValueOf,
} from "../descriptor";
import { I18nSelector, newI18nSelector } from "./i18n";
import { newNumberSelector, NumberSelector } from "./number";

export type SelectorOf<Ctx, D extends Descriptor> = [D] extends [
  ObjectDescriptor
]
  ? ObjectSelector<Ctx, D["props"]>
  : [D] extends [ArrayDescriptor]
  ? ArraySelector<Ctx, D["item"]>
  : [D] extends [I18nDescriptor]
  ? I18nSelector<Ctx, D["desc"]>
  : [D] extends [NumberDescriptor]
  ? NumberSelector<Ctx>
  : Selector<Ctx, ValueOf<D>>;

export function getSelector<Ctx, D extends Descriptor>(
  expr: expr.Expr<Ctx, ValueOf<D>>,
  desc: D
): SelectorOf<Ctx, D> {
  switch (desc.type) {
    case "array":
      return newArraySelector<Ctx, Descriptor>(
        expr as expr.Expr<Ctx, ValueOf<Descriptor>[]>,
        desc.item
      ) as SelectorOf<Ctx, D>;
    case "i18n":
      return newI18nSelector(
        expr as expr.Expr<Ctx, Record<"en_US", ValueOf<Descriptor>>>,
        desc.desc
      ) as SelectorOf<Ctx, D>;
    case "object":
      return newObjectSelector<Ctx, ObjectDescriptorProps>(
        expr as expr.Expr<Ctx, ValueOf<ObjectDescriptor>>,
        desc.props
      ) as unknown as SelectorOf<Ctx, D>;
    case "number":
      return newNumberSelector(expr as expr.Expr<Ctx, number>) as SelectorOf<
        Ctx,
        D
      >;
    case "string":
    case "boolean":
      return new PrimitiveSelector(expr) as unknown as SelectorOf<Ctx, D>;
  }
}
