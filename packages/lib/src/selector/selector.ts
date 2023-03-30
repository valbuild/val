import * as expr from "../expr";
import { BooleanDescriptor, Descriptor, ValueOf } from "../descriptor";
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

export abstract class Selector<Ctx, D extends Descriptor> {
  /**
   * @internal
   */
  abstract [EXPR](): expr.Expr<Ctx, ValueOf<D>>;
  /**
   * @internal
   */
  abstract [DESC](): D;
  eq(value: ValueOf<D>): PrimitiveSelector<Ctx, BooleanDescriptor> {
    return getSelector(expr.eq(this[EXPR](), value), BooleanDescriptor);
  }
}
