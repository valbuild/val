import { formatJSONPointerReferenceToken } from "../patch/parse";
import { lastIndexOf, split } from "./strings";
export * as strings from "./strings";

type ToStringCtx<Ctx> = { readonly [s in keyof Ctx]: string };

/**
 * A Ref is a JSON pointer that represents the source of the value of an
 * expression. If the value is a derived array, the Ref may be an array of JSON
 * pointers. A Ref may also be null, meaning that the value of the expression is
 * not assignable.
 */
export type Ref<T> = (T extends (infer U)[] ? Ref<U>[] : never) | string | null;
export type ValueAndRef<T> = readonly [value: T, ref: Ref<T>];
type RefCtx<Ctx> = {
  readonly [s in keyof Ctx]: Ref<Ctx[s]>;
};

export function isSingular(ref: Ref<unknown>): ref is string {
  return typeof ref === "string";
}

function refIndex<T>(ref: Ref<T[]>, i: number): Ref<T> {
  if (ref === null) {
    return null;
  }
  if (Array.isArray(ref)) {
    return ref[i];
  } else {
    return `${ref}/${i}`;
  }
}
function refProp<P extends string | number, T>(
  ref: Ref<{ [p in P]: T }>,
  prop: P
): Ref<T> {
  if (ref === null) {
    return null;
  }
  if (Array.isArray(ref)) {
    return ref[prop as number];
  } else {
    return `${ref}/${formatJSONPointerReferenceToken(prop.toString())}`;
  }
}

/**
 * An Expr is an expression which can be evaluated to a value. The value may
 * optionally be assignable.
 */
export interface Expr<Ctx, T> {
  /**
   * Evaluate the value of the expression.
   */
  evaluate(ctx: Ctx): T;
  /**
   * Evaluate the value of the expression, optionally as an assignable value.
   */
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T>;
  toString(ctx: ToStringCtx<Ctx>): string;
}

class Literal<Ctx, T> implements Expr<Ctx, T> {
  constructor(private readonly value: T) {}
  evaluate(): T {
    return this.value;
  }
  evaluateRef(): [T, null] {
    return [this.value, null];
  }
  toString(): string {
    return JSON.stringify(this.value);
  }
}
export function literal<Ctx, T>(value: T): Expr<Ctx, T> {
  return new Literal(value);
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

class Prop<
  Ctx,
  P extends string | number,
  T extends { readonly [key in P]: unknown }
> implements Expr<Ctx, T[P]>
{
  constructor(private readonly expr: Expr<Ctx, T>, private readonly key: P) {}
  evaluate(ctx: Ctx): T[P] {
    return this.expr.evaluate(ctx)[this.key];
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[P]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    return [value[this.key], refProp(ref, this.key)];
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
    const resRef: Ref<T>[] = [];
    for (let i = 0; i < value.length; ++i) {
      const item = value[i];
      if (this.predicate.evaluate([item])) {
        resValue.push(item);
        resRef.push(refIndex(ref, i));
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
    return [value[idx], refIndex(ref, idx)];
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
    const retRef = retValue.map((_item, i) => refIndex(ref, this.start + i));
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
    const resRef: Ref<T>[] = [];
    value
      .map((item, i) => [item, i] as const)
      .sort(([a], [b]) => this.keyFn.evaluate([a]) - this.keyFn.evaluate([b]))
      .forEach(([item, i]) => {
        resValue.push(item);
        resRef.push(refIndex(ref, i));
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

class Sort<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly compareFn: Expr<readonly [T, T], number>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr
      .evaluate(ctx)
      .slice()
      .sort((a, b) => this.compareFn.evaluate([a, b]));
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T[]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const resValue: T[] = [];
    const resRef: Ref<T>[] = [];
    value
      .map((item, i) => [item, i] as const)
      .sort(([a], [b]) => this.compareFn.evaluate([a, b]))
      .forEach(([item, i]) => {
        resValue.push(item);
        resRef.push(refIndex(ref, i));
      });
    return [resValue, resRef];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.sort((a, b) => ${this.compareFn.toString(
      ["a", "b"]
    )})`;
  }
}
export function sort<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  compareFn: Expr<readonly [T, T], number>
): Expr<Ctx, T[]> {
  return new Sort(expr, compareFn);
}

class Eq<Ctx, T> implements Expr<Ctx, boolean> {
  constructor(
    private readonly lhs: Expr<Ctx, T>,
    private readonly rhs: Expr<Ctx, T>
  ) {}
  evaluate(ctx: Ctx): boolean {
    // TODO: Implement deep equality
    return this.lhs.evaluate(ctx) === this.rhs.evaluate(ctx);
  }
  evaluateRef(ctx: Ctx): [boolean, null] {
    return [this.evaluate(ctx), null];
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `eq(${this.lhs.toString(ctx)}, ${this.rhs.toString(ctx)})`;
  }
}
export function eq<Ctx, T>(
  lhs: Expr<Ctx, T>,
  rhs: Expr<Ctx, T>
): Expr<Ctx, boolean> {
  return new Eq(lhs, rhs);
}

class Localize<Ctx, T> implements Expr<Ctx, T> {
  constructor(
    private readonly expr: Expr<Ctx, Record<"en_US", T>>,
    private readonly locale?: "en_US"
  ) {}
  evaluate(ctx: Ctx): T {
    return this.expr.evaluate(ctx)[this.locale ?? "en_US"];
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    return [
      value[this.locale ?? "en_US"],
      refProp(ref, this.locale ?? "en_US"),
    ];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.localize(${
      this.locale !== undefined ? JSON.stringify(this.locale) : ""
    })`;
  }
}
export function localize<Ctx, T>(
  expr: Expr<Ctx, Record<"en_US", T>>,
  locale?: "en_US"
): Expr<Ctx, T> {
  return new Localize(expr, locale);
}

export function parse<Ctx>(
  ctx: { readonly [s in string]: keyof Ctx },
  str: string
): Expr<Ctx, unknown> {
  // TODO: Fully implement this
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
    if (funcStr.endsWith(".sortBy")) {
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
    } else if (funcStr.endsWith(".sort")) {
      if (!argsStr.startsWith("(a, b) => ")) {
        throw Error("invalid sort lambda");
      }

      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".sort".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const compareFn = parse<readonly [unknown, unknown]>(
        {
          a: 0,
          b: 1,
        },
        argsStr.slice("(a, b) => ".length)
      ) as Expr<readonly [unknown, unknown], number>;
      return sort(expr, compareFn);
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
