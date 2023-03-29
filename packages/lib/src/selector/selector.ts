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

export abstract class Selector<Ctx, Out> {
  /**
   * @internal
   */
  abstract [EXPR](): expr.Expr<Ctx, Out>;
  /**
   * @internal
   */
  abstract [DESC](): Descriptor;
  eq(value: Out): PrimitiveSelector<Ctx, BooleanDescriptor> {
    return getSelector(expr.eq(this[EXPR](), value), BooleanDescriptor);
  }
}
