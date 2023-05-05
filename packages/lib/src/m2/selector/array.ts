import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SOURCE,
  VAL_OR_EXPR,
} from ".";
import { Schema } from "../schema";
import { ArraySchema } from "../schema/array";
import { SourceArray } from "../Source";
import { SourcePath, Val } from "../val";
import { createSelector } from "./create";
import * as expr from "../expr/expr";

export type UndistributedSourceArray<T extends SourceArray> = [T] extends [
  infer U // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends SourceArray
    ? Selector<U>
    : never
  : never;

type Selector<T extends SourceArray> = ArraySelector<T> & {
  readonly [key in keyof T & number]: UnknownSelector<T[key]>;
};

export class ArraySelector<T extends SourceArray>
  extends SelectorC<T>
  implements AsVal<T>
{
  constructor(valOrExpr: expr.Expr | Val<T>) {
    super(valOrExpr);
  }
  [VAL_OR_EXPR](): expr.Expr | Val<T> {
    return this.valOrExpr;
  }
  readonly length: UnknownSelector<T["length"]> = null as never; // TODO: !

  filter(
    predicate: (v: UnknownSelector<T[number]>) => SelectorOf<boolean>
  ): SelectorOf<T> {
    throw Error("TODO: implement me");
  }
  map<U extends SelectorSource>(
    f: (v: UnknownSelector<T[number]>, i: UnknownSelector<number>) => U
  ): SelectorOf<U[]> {
    throw Error("TODO: implement me");
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> {
    throw Error("TODO: implement me");
  }
}
