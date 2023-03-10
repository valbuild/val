import * as lens from "../lens";
import { BaseSelector, LENS, Selector } from "./selector";

export class PrimitiveSelector<Src, T>
  extends BaseSelector<Src, T>
  implements Selector<Src, T>
{
  constructor(private readonly fromSrc: lens.Lens<Src, T>) {
    super();
  }

  [LENS](): lens.Lens<Src, T> {
    return this.fromSrc;
  }
}

export function newPrimitiveSelector<Src, T>(
  fromSrc: lens.Lens<Src, T>
): Selector<Src, T> {
  return new PrimitiveSelector(fromSrc);
}
