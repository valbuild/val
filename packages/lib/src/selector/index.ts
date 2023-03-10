import * as lens from "../lens";
import { ArraySelector, newArraySelector } from "./array";
import { PrimitiveSelector } from "./primitive";
import { newObjectSelector, ObjectSelector } from "./object";
import { Selector } from "./selector";
import {
  ArrayDescriptor,
  Descriptor,
  ObjectDescriptor,
  ValueOf,
} from "../lens/descriptor";

export type SelectorOf<Src, D extends Descriptor> = D extends ObjectDescriptor
  ? ObjectSelector<Src, D>
  : D extends ArrayDescriptor
  ? ArraySelector<Src, D>
  : D extends Descriptor
  ? Selector<Src, D>
  : Selector<Src, Descriptor>;

export function getSelector<Src, D extends Descriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>>,
  desc: D
): SelectorOf<Src, D> {
  switch (desc.type) {
    case "array":
      return newArraySelector<Src, ArrayDescriptor>(
        fromSrc as lens.Lens<Src, ValueOf<ArrayDescriptor>>,
        desc
      ) as SelectorOf<Src, D>;
    case "object":
      return newObjectSelector<Src, ObjectDescriptor>(
        fromSrc as lens.Lens<Src, ValueOf<ObjectDescriptor>>,
        desc
      ) as unknown as SelectorOf<Src, D>;
    case "string":
    case "boolean":
      return new PrimitiveSelector(fromSrc) as unknown as SelectorOf<Src, D>;
  }
}
