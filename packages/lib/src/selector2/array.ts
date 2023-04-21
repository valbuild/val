import { Source } from "../Source";
import { DESC, EXPR, Selected, Selector, newSelector } from ".";
import {
  ArrayDescriptor,
  ARRAY_VALUE,
  Descriptor,
  NullDescriptor,
  NumberDescriptor,
  UnionDescriptor,
} from "../descriptor2";
import { expr } from "..";

export function filter<V extends Source, Ctx>(
  s: Selector<readonly V[], Ctx>,
  predicate: <Ctx1>(v: Selector<V, Ctx1>) => Selected<Source, Ctx1>
): Selector<V[], Ctx> {
  type Ctx1 = readonly [V];

  const itemDesc: Descriptor<V> = s[DESC][ARRAY_VALUE];
  const predicateExpr = predicate<Ctx1>(
    newSelector(itemDesc, expr.fromCtx<Ctx1, 0>(0))
  )[EXPR];
  const outDesc = ArrayDescriptor.create(itemDesc) as Descriptor<V[]>;
  const outExpr = expr.filter<Ctx, V>(s[EXPR], predicateExpr);
  return newSelector(outDesc, outExpr);
}

export function find<V extends Source, Ctx>(
  s: Selector<readonly V[], Ctx>,
  predicate: <Ctx1>(v: Selector<V, Ctx1>) => Selected<Source, Ctx1>
): Selector<V | null, Ctx> {
  type Ctx1 = readonly [V];

  const itemDesc: Descriptor<V> = s[DESC][ARRAY_VALUE];
  const predicateExpr = predicate<Ctx1>(
    newSelector(itemDesc, expr.fromCtx<Ctx1, 0>(0))
  )[EXPR];
  const outDesc = UnionDescriptor.create<V | null>([itemDesc, NullDescriptor]);
  const outExpr = expr.find<Ctx, V>(s[EXPR], predicateExpr);
  return newSelector(outDesc, outExpr);
}

export function slice<V extends Source, Ctx>(
  s: Selector<readonly V[], Ctx>,
  begin: number,
  end?: number
): Selector<V[], Ctx> {
  const itemDesc: Descriptor<V> = s[DESC][ARRAY_VALUE];
  const outDesc = ArrayDescriptor.create(itemDesc);
  const outExpr = expr.slice<Ctx, V>(s[EXPR], begin, end);
  return newSelector(outDesc, outExpr);
}

export function sortBy<V extends Source, Ctx>(
  s: Selector<readonly V[], Ctx>,
  keyFn: <Ctx1>(v: Selector<V, Ctx1>) => Selected<number, Ctx1>
): Selector<V[], Ctx> {
  type Ctx1 = readonly [V];

  const itemDesc: Descriptor<V> = s[DESC][ARRAY_VALUE];
  const keyExpr = keyFn<Ctx1>(newSelector(itemDesc, expr.fromCtx<Ctx1, 0>(0)))[
    EXPR
  ];
  const outDesc = ArrayDescriptor.create(itemDesc);
  const outExpr = expr.sortBy<Ctx, V>(s[EXPR], keyExpr);
  return newSelector(outDesc, outExpr);
}

export function reverse<V extends Source, Ctx>(
  s: Selected<readonly V[], Ctx>
): Selector<V[], Ctx> {
  const itemDesc: Descriptor<V> = s[DESC][ARRAY_VALUE];
  const outDesc = ArrayDescriptor.create(itemDesc);
  const outExpr = expr.reverse<Ctx, V>(s[EXPR]);
  return newSelector(outDesc, outExpr);
}

export function map<V extends Source, Ctx, U extends Source>(
  s: Selector<readonly V[], Ctx>,
  callback: <Ctx1>(
    v: Selector<V, Ctx1>,
    i: Selector<number, Ctx1>
  ) => Selected<U, Ctx1>
): Selector<U[], Ctx> {
  type Ctx1 = readonly [V, number];

  const itemDesc: Descriptor<V> = s[DESC][ARRAY_VALUE];
  const callbackSelector = callback<Ctx1>(
    newSelector(itemDesc, expr.fromCtx<Ctx1, 0>(0)),
    newSelector(NumberDescriptor, expr.fromCtx<Ctx1, 1>(1))
  );
  const outDesc = ArrayDescriptor.create(callbackSelector[DESC]);
  const outExpr = expr.map<Ctx, V, U>(s[EXPR], callbackSelector[EXPR]);
  return newSelector(outDesc, outExpr);
}
