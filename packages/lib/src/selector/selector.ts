import { getSelector } from ".";
import * as op from "../op";
import { BooleanDescriptor } from "../descriptor";

/**
 * @internal
 */
export const OP: unique symbol = Symbol("op");

export interface Selector<Src, Out> {
  eq(value: unknown): Selector<Src, boolean>;
  /**
   * @internal
   */
  [OP](): op.Op<Src, Out>;
}

export abstract class BaseSelector<Src, Out> implements Selector<Src, Out> {
  abstract [OP](): op.Op<Src, Out>;
  eq(value: unknown): Selector<Src, boolean> {
    return getSelector(op.compose(this[OP](), op.eq(value)), BooleanDescriptor);
  }
}
