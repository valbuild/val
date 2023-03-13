import { getSelector } from ".";
import * as lens from "../lens";
import { BooleanDescriptor } from "../lens/descriptor";

/**
 * @internal
 */
export const LENS: unique symbol = Symbol("lens");

export interface Selector<Src, Out> {
  eq(value: unknown): Selector<Src, boolean>;
  /**
   * @internal
   */
  [LENS](): lens.Lens<Src, Out>;
}

export abstract class BaseSelector<Src, Out> implements Selector<Src, Out> {
  abstract [LENS](): lens.Lens<Src, Out>;
  eq(value: unknown): Selector<Src, boolean> {
    return getSelector(
      lens.compose(this[LENS](), lens.eq(value)),
      BooleanDescriptor
    );
  }
}
