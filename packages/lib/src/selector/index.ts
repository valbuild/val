import * as op from "../op";
import { ArraySelector, newArraySelector } from "./array";
import { PrimitiveSelector } from "./primitive";
import { newObjectSelector, ObjectSelector } from "./object";
import { Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  I18nDescriptor,
  ObjectDescriptor,
  ObjectDescriptorProps,
  ValueOf,
} from "../descriptor";
import { I18nSelector, newI18nSelector } from "./i18n";

export type SelectorOf<Src, D extends Descriptor> = [D] extends [
  ObjectDescriptor
]
  ? ObjectSelector<Src, D["props"]>
  : [D] extends [ArrayDescriptor]
  ? ArraySelector<Src, D["item"]>
  : [D] extends [I18nDescriptor]
  ? I18nSelector<Src, D["desc"]>
  : Selector<Src, ValueOf<D>>;

export function getSelector<Src, D extends Descriptor>(
  fromSrc: op.Op<Src, ValueOf<D>>,
  desc: D
): SelectorOf<Src, D> {
  switch (desc.type) {
    case "array":
      return newArraySelector<Src, Descriptor>(
        fromSrc as op.Op<Src, ValueOf<Descriptor>[]>,
        desc.item
      ) as SelectorOf<Src, D>;
    case "i18n":
      return newI18nSelector(
        fromSrc as op.Op<Src, Record<"en_US", ValueOf<Descriptor>>>,
        desc.desc
      ) as SelectorOf<Src, D>;
    case "object":
      return newObjectSelector<Src, ObjectDescriptorProps>(
        fromSrc as op.Op<Src, ValueOf<ObjectDescriptor>>,
        desc.props
      ) as unknown as SelectorOf<Src, D>;
    case "string":
    case "boolean":
      return new PrimitiveSelector(fromSrc) as unknown as SelectorOf<Src, D>;
  }
}
