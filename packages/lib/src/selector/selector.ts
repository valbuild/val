import { getSelector } from ".";
import * as expr from "../expr";
import { BooleanDescriptor } from "../descriptor";

/**
 * @internal
 */
export const EXPR = Symbol("expr");

export interface Selector<Ctx, Out> {
  eq(value: Out): Selector<Ctx, boolean>;
  /**
   * @internal
   */
  [EXPR](): expr.Expr<Ctx, Out>;
}

export abstract class BaseSelector<Ctx, Out> implements Selector<Ctx, Out> {
  abstract [EXPR](): expr.Expr<Ctx, Out>;
  eq(value: Out): Selector<Ctx, boolean> {
    return getSelector(
      expr.eq(this[EXPR](), expr.literal(value)),
      BooleanDescriptor
    );
  }
}
