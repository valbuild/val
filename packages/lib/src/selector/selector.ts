import { getSelector } from ".";
import * as lens from "../lens";
import { BooleanDescriptor, Descriptor, ValueOf } from "../lens/descriptor";

/**
 * @internal
 */
export const LENS: unique symbol = Symbol("lens");

export interface Selector<Src, D extends Descriptor> {
  eq(value: unknown): Selector<Src, BooleanDescriptor>;
  /**
   * @internal
   */
  [LENS](): lens.Lens<Src, ValueOf<D>>;
}

export abstract class BaseSelector<Src, D extends Descriptor>
  implements Selector<Src, D>
{
  abstract [LENS](): lens.Lens<Src, ValueOf<D>>;
  eq(value: unknown): Selector<Src, BooleanDescriptor> {
    return getSelector(
      lens.compose(this[LENS](), lens.eq(value)),
      BooleanDescriptor
    );
  }
}
