import * as expr from "../expr";
import { BooleanDescriptor, Descriptor } from "../descriptor";
import { type PrimitiveSelector } from "./primitive";
import { getSelector } from ".";

/**
 * @internal
 */
export const EXPR = Symbol("expr");
/**
 * @internal
 */
export const DESC = Symbol("desc");

export interface Selector<Ctx, Out> {
  eq(value: Out): PrimitiveSelector<Ctx, BooleanDescriptor>;
  /**
   * @internal
   */
  [EXPR](): expr.Expr<Ctx, Out>;
  /**
   * @internal
   */
  [DESC](): Descriptor;
}

export abstract class BaseSelector<Ctx, Out> implements Selector<Ctx, Out> {
  abstract [EXPR](): expr.Expr<Ctx, Out>;
  abstract [DESC](): Descriptor;
  eq(value: Out): PrimitiveSelector<Ctx, BooleanDescriptor> {
    return getSelector(expr.eq(this[EXPR](), value), BooleanDescriptor);
  }
}
