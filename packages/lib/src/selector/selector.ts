import * as expr from "../expr";
import { BooleanDescriptor, Descriptor, ValueOf } from "../descriptor";
import { type PrimitiveSelector } from "./primitive";
import { getSelector } from ".";
import { Source } from "../Source";

/**
 * @internal
 */
export const EXPR = Symbol("expr");
/**
 * @internal
 */
export const DESC = Symbol("desc");

export abstract class Selector<D extends Descriptor<Source>, Ctx> {
  /**
   * @internal
   */
  abstract [EXPR](): expr.Expr<Ctx, ValueOf<D>>;
  /**
   * @internal
   */
  abstract [DESC](): D;
  eq(value: ValueOf<D>): PrimitiveSelector<BooleanDescriptor, Ctx> {
    return getSelector(expr.eq(this[EXPR](), value), BooleanDescriptor);
  }
}
