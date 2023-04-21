import { Source, SourceObject } from "../Source";
import { DESC, eq, EXPR, Selected, Selector as SelectorT } from ".";
import { expr } from "..";
import { ARRAY_VALUE, DEBUG_STRING, Descriptor } from "../descriptor2";
import * as ArrayFunctions from "./array";

function getSelectorMethod<V extends Source, Ctx>(
  desc: Descriptor<V>,
  p: string | symbol
): ((this: SelectorT<V, Ctx>, ...args: unknown[]) => unknown) | undefined {
  if (ARRAY_VALUE in desc) {
    const arrayFunction = ArrayFunctions[p as keyof typeof ArrayFunctions] as
      | ((s: SelectorT<V, Ctx>, ...args: unknown[]) => Selected<Source, Ctx>)
      | undefined;
    if (arrayFunction) {
      return function (this: SelectorT<V, Ctx>, ...args: unknown[]) {
        return arrayFunction(this, ...args);
      };
    }
  }

  if (p === "eq") {
    return function (this: SelectorT<V, Ctx>, value: unknown) {
      return eq(this, value as V);
    };
  }

  return undefined;
}

const APPLY = Symbol("APPLY");
export class Selector<V extends Source, Ctx> {
  readonly [DESC]: Descriptor<V>;
  readonly [EXPR]: expr.Expr<Ctx, V>;
  readonly [APPLY]?: (...args: unknown[]) => unknown;
  constructor(
    desc: Descriptor<V>,
    expr: expr.Expr<Ctx, V>,
    apply?: (this: SelectorT<V, Ctx>, ...args: unknown[]) => unknown
  ) {
    this[DESC] = desc;
    this[EXPR] = expr;
    this[APPLY] = apply;
    return new Proxy(this, Selector.proxyHandler);
  }

  private static readonly proxyHandler = {
    apply<V extends Source, Ctx>(
      target: Selector<V, Ctx>,
      thisArg: SelectorT<V, Ctx>,
      argArray: unknown[]
    ) {
      if (target[APPLY]) {
        return target[APPLY].apply(thisArg, argArray);
      } else {
        throw TypeError("Selector is not a function");
      }
    },
    get<V extends Source, Ctx>(target: Selector<V, Ctx>, p: string | symbol) {
      if (p === DESC || p === EXPR) {
        return target[p as typeof DESC | typeof EXPR];
      }

      const desc = target[DESC];

      const method = getSelectorMethod(desc, p);

      if (typeof p === "string" && p in desc) {
        return Selector.create<Source, Ctx>(
          (desc as Descriptor<SourceObject>)[p],
          expr.prop(target[EXPR] as expr.Expr<Ctx, SourceObject>, p),
          method
        );
      }

      if (method) {
        return method;
      }

      throw Error(
        `Select failed: "${p.toString()}" is not a known property or method of a value of type ${target[
          DESC
        ][DEBUG_STRING]()}`
      );
    },
    set() {
      throw TypeError("Cannot set property on selector");
    },
  };

  static create<V extends Source, Ctx>(
    desc: Descriptor<V>,
    expr: expr.Expr<Ctx, V>,
    apply?: (...args: unknown[]) => unknown
  ): SelectorT<V, Ctx> {
    return new Selector<V, Ctx>(desc, expr, apply) as SelectorT<V, Ctx>;
  }
}
