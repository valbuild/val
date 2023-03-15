import * as op from "../op";
import { BaseSelector, OP, Selector } from "./selector";

export class PrimitiveSelector<Src, Out>
  extends BaseSelector<Src, Out>
  implements Selector<Src, Out>
{
  constructor(private readonly fromSrc: op.Op<Src, Out>) {
    super();
  }

  [OP](): op.Op<Src, Out> {
    return this.fromSrc;
  }
}

export function newPrimitiveSelector<Src, Out>(
  fromSrc: op.Op<Src, Out>
): Selector<Src, Out> {
  return new PrimitiveSelector(fromSrc);
}
