import * as lens from "../lens";
import { BaseSelector, LENS, Selector } from "./selector";

export class PrimitiveSelector<Src, Out>
  extends BaseSelector<Src, Out>
  implements Selector<Src, Out>
{
  constructor(private readonly fromSrc: lens.Lens<Src, Out>) {
    super();
  }

  [LENS](): lens.Lens<Src, Out> {
    return this.fromSrc;
  }
}

export function newPrimitiveSelector<Src, Out>(
  fromSrc: lens.Lens<Src, Out>
): Selector<Src, Out> {
  return new PrimitiveSelector(fromSrc);
}
