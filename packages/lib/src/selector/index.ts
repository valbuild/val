import * as lens from "../lens";
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
} from "../lens/descriptor";
import { I18nSelector, newI18nSelector } from "./i18n";

export type SelectorOf<Src, D extends Descriptor> = D extends ObjectDescriptor
  ? ObjectSelector<Src, D["props"]>
  : D extends ArrayDescriptor
  ? ArraySelector<Src, D["item"]>
  : D extends I18nDescriptor
  ? I18nSelector<Src, D["desc"]>
  : Selector<Src, ValueOf<D>>;

export function getSelector<Src, D extends Descriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>>,
  desc: D
): SelectorOf<Src, D> {
  switch (desc.type) {
    case "array":
      return newArraySelector<Src, Descriptor>(
        fromSrc as lens.Lens<Src, ValueOf<Descriptor>[]>,
        desc.item
      ) as SelectorOf<Src, D>;
    case "i18n":
      return newI18nSelector(fromSrc, desc.desc) as SelectorOf<Src, D>;
    case "object":
      return newObjectSelector<Src, ObjectDescriptorProps>(
        fromSrc as lens.Lens<Src, ValueOf<ObjectDescriptor>>,
        desc.props
      ) as unknown as SelectorOf<Src, D>;
    case "string":
    case "boolean":
      return new PrimitiveSelector(fromSrc) as unknown as SelectorOf<Src, D>;
  }
}
