import { formatJSONPointerReferenceToken } from "../patch/parse";
import { lastIndexOf, split } from "./strings";
export * as strings from "./strings";

/**
 * A Ref represents the (possibly) assignable source of an expression's value.
 *
 * For simple expressions such as those accessing object properties or array
 * items, the Ref is a simple JSON pointer string and the value is assignable.
 *
 * For derived array values such as those produced by sorting/filtering/slicing,
 * the Ref may be an array of Refs describing the source of each value in the
 * array. In this case, the array itself is not assignable, but values derived
 * from the array may be.
 *
 * For other expressions such as literals and those consisting of arithmetic
 * operations, the Ref is null and its value is not assignable.
 */
export type Ref = Ref[] | string | null;
export type ValueAndRef<T> = readonly [value: T, ref: Ref];

export function isAssignable(ref: Ref): ref is string {
  return typeof ref === "string";
}

function propRef<T, P extends keyof T>(ref: Ref, prop: P): Ref {
  if (ref === null) {
    return null;
  } else if (typeof ref === "string") {
    return `${ref}/${formatJSONPointerReferenceToken(prop.toString())}`;
  } else {
    return (ref as { [p in P]: Ref })[prop];
  }
}

type RefCtx<Ctx> = {
  readonly [s in keyof Ctx]: Ref;
};
type ToStringCtx<Ctx> = { readonly [s in keyof Ctx]: string };

/**
 * An Expr is an expression which can be evaluated to a value. The expression's
 * value may be assignable.
 */
export interface Expr<Ctx, T> {
  /**
   * Evaluate the value of the expression.
   */
  evaluate(ctx: Ctx): T;
  /**
   * Evaluate the value and Ref of the expression.
   */
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T>;
  toString(ctx: ToStringCtx<Ctx>): string;
}

class FromCtx<Ctx extends { readonly [s in S]: unknown }, S extends PropertyKey>
  implements Expr<Ctx, Ctx[S]>
{
  constructor(private readonly symbol: S) {}
  evaluate(ctx: Ctx): Ctx[S] {
    return ctx[this.symbol];
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<Ctx[S]> {
    return [ctx[this.symbol], refCtx[this.symbol]];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return ctx[this.symbol];
  }
}
export function fromCtx<
  Ctx extends { readonly [s in S]: unknown },
  S extends PropertyKey
>(sym: S): Expr<Ctx, Ctx[S]> {
  return new FromCtx(sym);
}

class Prop<Ctx, T, P extends keyof T> implements Expr<Ctx, T[P]> {
  constructor(private readonly expr: Expr<Ctx, T>, private readonly key: P) {}
  evaluate(ctx: Ctx): T[P] {
    return this.expr.evaluate(ctx)[this.key];
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[P]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    return [value[this.key], propRef<T, P>(ref, this.key)];
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}[${JSON.stringify(this.key)}]`;
  }
}
export function prop<
  Ctx,
  P extends string | number,
  T extends { readonly [key in P]: unknown }
>(expr: Expr<Ctx, T>, key: P): Expr<Ctx, T[P]> {
  return new Prop(expr, key);
}
/**
 * Alias for {@link prop}
 */
export function item<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  key: number
): Expr<Ctx, T> {
  return new Prop(expr, key);
}

class Filter<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly predicate: Expr<readonly [T], unknown>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).filter((item) => {
      return this.predicate.evaluate([item]);
    });
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    if (ref === null) {
      return [this.evaluate(ctx), null];
    }
    const resValue: T[] = [];
    const resRef: Ref[] = [];
    for (let i = 0; i < value.length; ++i) {
      const item = value[i];
      if (this.predicate.evaluate([item])) {
        resValue.push(item);
        resRef.push(propRef<T[], number>(ref, i));
      }
    }
    return [resValue, resRef];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.filter((v) => ${this.predicate.toString([
      "v",
    ])})`;
  }
}
export function filter<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  predicate: Expr<readonly [T], unknown>
): Expr<Ctx, T[]> {
  return new Filter(expr, predicate);
}

class Find<Ctx, T> implements Expr<Ctx, T | undefined> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly predicate: Expr<readonly [T], unknown>
  ) {}
  evaluate(ctx: Ctx): T | undefined {
    return this.expr
      .evaluate(ctx)
      .find((item) => this.predicate.evaluate([item]));
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T | undefined> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const idx = value.findIndex((item) => this.predicate.evaluate([item]));
    if (idx === -1) {
      return [undefined, null];
    }
    return [value[idx], propRef<T[], number>(ref, idx)];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.find((v) => ${this.predicate.toString([
      "v",
    ])})`;
  }
}
export function find<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  predicate: Expr<readonly [T], unknown>
): Expr<Ctx, T | undefined> {
  return new Find(expr, predicate);
}

class Slice<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly start: number,
    private readonly end?: number
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).slice(this.start, this.end);
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const retValue = value.slice(this.start, this.end);
    const retRef = retValue.map((_item, i) =>
      propRef<T[], number>(ref, this.start + i)
    );
    return [retValue, retRef];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.slice(${[this.start, this.end]
      .filter((item) => item !== undefined)
      .join(", ")})`;
  }
}
export function slice<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  start: number,
  end?: number
): Expr<Ctx, T[]> {
  return new Slice(expr, start, end);
}

class SortBy<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly keyFn: Expr<readonly [T], number>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr
      .evaluate(ctx)
      .slice()
      .sort((a, b) => this.keyFn.evaluate([a]) - this.keyFn.evaluate([b]));
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const resValue: T[] = [];
    const resRef: Ref[] = [];
    value
      .map((item, i) => [item, i] as const)
      .sort(([a], [b]) => this.keyFn.evaluate([a]) - this.keyFn.evaluate([b]))
      .forEach(([item, i]) => {
        resValue.push(item);
        resRef.push(propRef<T[], number>(ref, i));
      });
    return [resValue, resRef];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.sortBy((v) => ${this.keyFn.toString([
      "v",
    ])})`;
  }
}
export function sortBy<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  keyFn: Expr<readonly [T], number>
): Expr<Ctx, T[]> {
  return new SortBy(expr, keyFn);
}

class Reverse<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(private readonly expr: Expr<Ctx, readonly T[]>) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).slice().reverse();
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const resValue: T[] = [];
    const resRef: Ref[] = [];
    value
      .map((item, i) => [item, i] as const)
      .reverse()
      .forEach(([item, i]) => {
        resValue.push(item);
        resRef.push(propRef<T[], number>(ref, i));
      });
    return [resValue, resRef];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.reverse()`;
  }
}
export function reverse<Ctx, T>(expr: Expr<Ctx, readonly T[]>): Expr<Ctx, T[]> {
  return new Reverse(expr);
}

class Eq<Ctx, T> implements Expr<Ctx, boolean> {
  constructor(private readonly lhs: Expr<Ctx, T>, private readonly rhs: T) {}
  evaluate(ctx: Ctx): boolean {
    // TODO: Implement deep equality
    return this.lhs.evaluate(ctx) === this.rhs;
  }
  evaluateRef(ctx: Ctx): [boolean, null] {
    return [this.evaluate(ctx), null];
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.lhs.toString(ctx)}.eq(${JSON.stringify(this.rhs)})`;
  }
}
export function eq<Ctx, T>(lhs: Expr<Ctx, T>, rhs: T): Expr<Ctx, boolean> {
  return new Eq(lhs, rhs);
}

export function parse<Ctx>(
  ctx: { readonly [s in string]: keyof Ctx },
  str: string
): Expr<Ctx, unknown> {
  // TODO: Fully implement this
  // Currently missing: sub
  if (str.endsWith("]")) {
    const bracketStart = lastIndexOf(str, "[");
    if (bracketStart === -1) {
      throw Error("Matching bracket not found");
    }

    const key: string | number = JSON.parse(
      str.slice(bracketStart + 1, str.length - 1)
    );
    const expr = parse(ctx, str.slice(0, bracketStart)) as Expr<
      Ctx,
      { [s in typeof key]: unknown }
    >;
    return prop(expr, key);
  } else if (str.endsWith(")")) {
    const parenStart = lastIndexOf(str, "(");
    if (parenStart === -1) {
      throw Error("Matching parenthesis not found");
    }

    const argsStr = str.slice(parenStart + 1, str.length - 1);
    const funcStr = str.slice(0, parenStart);
    if (funcStr.endsWith(".eq")) {
      const lhs = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".eq".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const rhs = JSON.parse(argsStr);
      return eq(lhs, rhs);
    } else if (funcStr.endsWith(".sortBy")) {
      if (!argsStr.startsWith("(v) => ")) {
        throw Error("invalid sortBy lambda");
      }

      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".sortBy".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const keyFn = parse<readonly [unknown]>(
        {
          v: 0,
        },
        argsStr.slice("(v) => ".length)
      ) as Expr<readonly [unknown], number>;
      return sortBy(expr, keyFn);
    } else if (funcStr.endsWith(".reverse")) {
      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".reverse".length)
      ) as Expr<Ctx, readonly unknown[]>;
      return reverse(expr);
    } else if (funcStr.endsWith(".filter")) {
      if (!argsStr.startsWith("(v) => ")) {
        throw Error("invalid filter lambda");
      }

      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".filter".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const predicate = parse<readonly [unknown]>(
        {
          v: 0,
        },
        argsStr.slice("(v) => ".length)
      );
      return filter(expr, predicate);
    } else if (funcStr.endsWith(".find")) {
      if (!argsStr.startsWith("(v) => ")) {
        throw Error("invalid find lambda");
      }

      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".find".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const predicate = parse<readonly [unknown]>(
        {
          v: 0,
        },
        argsStr.slice("(v) => ".length)
      );
      return find(expr, predicate);
    } else if (funcStr.endsWith(".slice")) {
      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".slice".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const args = split(argsStr, ", ").map((arg) => JSON.parse(arg));
      if (args.length < 1 || args.length > 2) {
        throw Error("invalid number of slice arguments");
      }
      const [start, end] = args as [unknown, unknown?];
      if (typeof start !== "number") {
        throw Error("first argument of slice must be a number literal");
      }
      if (typeof end !== "number" && typeof end !== "undefined") {
        throw Error("second argument of slice must be a number literal");
      }

      return slice(expr, start, end);
    }
  } else if (str in ctx) {
    return fromCtx(ctx[str]);
  }
  throw TypeError("Not implemented");
}
