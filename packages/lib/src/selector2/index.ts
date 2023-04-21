import { BooleanDescriptor, Descriptor } from "../descriptor2";
import { expr } from "..";
import { Source, SourceObject } from "../Source";
import { Selector as SelectorImpl } from "./selector";

type SelectorMethods<V extends Source, Ctx> = (V extends readonly Source[]
  ? {
      filter(
        predicate: <Ctx1>(
          v: Selector<V[number], Ctx1>
        ) => Selected<Source, Ctx1>
      ): Selector<V[number][], Ctx>;

      find(
        predicate: <Ctx1>(
          v: Selector<V[number], Ctx1>
        ) => Selected<Source, Ctx1>
      ): Selector<V[number] | null, Ctx>;

      slice(begin: number, end?: number): Selector<V, Ctx>;

      sortBy(
        keyFn: <Ctx1>(v: Selector<V[number], Ctx1>) => Selected<number, Ctx1>
      ): Selector<V[number][], Ctx>;

      reverse(): Selector<V[number][], Ctx>;

      map<U extends Source>(
        callback: <Ctx1>(
          v: Selector<V[number], Ctx1>,
          i: Selector<number, Ctx1>
        ) => Selected<U, Ctx1>
      ): Selector<U[], Ctx>;
    }
  : unknown) & {
  eq(value: V): Selector<boolean, Ctx>;
};

type SelectorProps<V extends Source, Ctx> = V extends readonly Source[]
  ? {
      [P in keyof V & number]: Selector<V[P], Ctx>;
    } & {
      length: Selector<V["length"], Ctx>;
    }
  : V extends SourceObject
  ? {
      [P in keyof V]: Selector<V[P], Ctx>;
    }
  : unknown;

export const DESC = Symbol("DESC");
export const EXPR = Symbol("EXPR");

export type Selected<V extends Source, Ctx> = {
  [DESC]: Descriptor<V>;
  [EXPR]: expr.Expr<Ctx, V>;
};
export type Selector<V extends Source, Ctx> = Selected<V, Ctx> &
  SelectorProps<V, Ctx> &
  SelectorMethods<V, Ctx>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SelectorVarianceTest<in In extends Source, out Out extends Source> = (
  v: Selector<In, never>
) => Selector<Out, unknown>;

export function newSelector<V extends Source, Ctx>(
  desc: Descriptor<V>,
  expr: expr.Expr<Ctx, V>
): Selector<V, Ctx> {
  return SelectorImpl.create(desc, expr);
}

export function eq<V extends Source, Ctx>(
  s: Selector<V, Ctx>,
  value: V
): Selector<boolean, Ctx> {
  return newSelector(BooleanDescriptor, expr.eq(s[EXPR], value));
}
