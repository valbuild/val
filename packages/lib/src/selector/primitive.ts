import * as lens from "../lens";
import { Descriptor, ValueOf } from "../lens/descriptor";
import { BaseSelector, LENS, Selector } from "./selector";

export class PrimitiveSelector<Src, D extends Descriptor>
  extends BaseSelector<Src, D>
  implements Selector<Src, D>
{
  constructor(private readonly fromSrc: lens.Lens<Src, ValueOf<D>>) {
    super();
  }

  [LENS](): lens.Lens<Src, ValueOf<D>> {
    return this.fromSrc;
  }
}

export function newPrimitiveSelector<Src, D extends Descriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>>
): Selector<Src, D> {
  return new PrimitiveSelector(fromSrc);
}
