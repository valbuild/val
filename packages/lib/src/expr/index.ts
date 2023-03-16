export interface Expr<Ctx, T> {
  evaluate(ctx: Ctx): T;
  toString(ctx: { readonly [s in keyof Ctx]: string }): string;
}

class Literal<Ctx, T> implements Expr<Ctx, T> {
  constructor(private readonly value: T) {}
  evaluate(): T {
    return this.value;
  }
  toString(): string {
    return JSON.stringify(this.value);
  }
}
export function literal<Ctx, T>(value: T): Expr<Ctx, T> {
  return new Literal(value);
}

class FromCtx<S extends symbol, T>
  implements Expr<{ readonly [s in S]: T }, T>
{
  constructor(private readonly symbol: S) {}
  evaluate(ctx: { readonly [s in S]: T }): T {
    return ctx[this.symbol];
  }
  toString(ctx: { readonly [s in S]: string }): string {
    return ctx[this.symbol];
  }
}
export function fromCtx<S extends symbol, T>(
  sym: S
): Expr<{ readonly [s in S]: T }, T> {
  return new FromCtx(sym);
}

export const MOD = Symbol("MOD");
export type ModContext<T> = {
  [MOD]: T;
};
export const mod = fromCtx<typeof MOD, never>(MOD);

class Prop<
  Ctx,
  P extends PropertyKey,
  T extends { readonly [key in P]: unknown }
> implements Expr<Ctx, T[P]>
{
  constructor(private readonly expr: Expr<Ctx, T>, private readonly key: P) {}
  evaluate(ctx: Ctx): T[P] {
    return this.expr.evaluate(ctx)[this.key];
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}[${JSON.stringify(this.key)}]`;
  }
}
export function prop<
  Ctx,
  P extends PropertyKey,
  T extends { [key in P]: unknown }
>(expr: Expr<Ctx, T>, key: P): Expr<Ctx, T[P]> {
  return new Prop(expr, key);
}

class Filter<Ctx, vSYm extends symbol, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly vSym: vSYm,
    private readonly predicate: Expr<{ [s in vSYm]: T }, unknown>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).filter((item) => {
      return this.predicate.evaluate({
        [this.vSym]: item,
      });
    });
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.filter((v) => ${this.predicate.toString({
      [this.vSym]: "v",
    })})`;
  }
}
export function filter<Ctx, VSym extends symbol, T>(
  expr: Expr<Ctx, T[]>,
  vSym: VSym,
  predicate: Expr<{ [s in VSym]: T }, unknown>
): Expr<Ctx, T[]> {
  return new Filter(expr, vSym, predicate);
}

/* class Find<T> implements Op<T[], T | undefined> {
  constructor(private readonly predicate: Op<T, unknown>) {}
  apply(input: T[]): T | undefined {
    return input.find((item) => this.predicate.apply(item));
  }
  toString(input: string): string {
    return `${input}.find((i) => ${this.predicate.toString("i")})`;
  }
}
export function find<T>(predicate: Op<T, unknown>): Op<T[], T | undefined> {
  return new Find(predicate);
} */

class Slice<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly start: number,
    private readonly end?: number
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).slice(this.start, this.end);
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.slice(${[this.start, this.end]
      .filter((item) => item !== undefined)
      .join(", ")})`;
  }
}
export function slice<Ctx, T>(
  expr: Expr<Ctx, T[]>,
  start: number,
  end?: number
): Expr<Ctx, T[]> {
  return new Slice(expr, start, end);
}

class SortBy<Ctx, VSym extends symbol, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly vSym: VSym,
    private readonly keyFn: Expr<{ [s in VSym]: T }, number>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr
      .evaluate(ctx)
      .sort(
        (a, b) =>
          this.keyFn.evaluate({ [this.vSym]: a }) -
          this.keyFn.evaluate({ [this.vSym]: b })
      );
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.sortBy((v) => ${this.keyFn.toString({
      [this.vSym]: "v",
    })})`;
  }
}
export function sortBy<Ctx, VSym extends symbol, T>(
  expr: Expr<Ctx, T[]>,
  vSym: VSym,
  keyFn: Expr<{ [s in VSym]: T }, number>
): Expr<Ctx, T[]> {
  return new SortBy(expr, vSym, keyFn);
}

class Sort<Ctx, ASym extends symbol, BSym extends symbol, T>
  implements Expr<Ctx, T[]>
{
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly aSym: ASym,
    private readonly bSym: BSym,
    private readonly compareFn: Expr<
      { [s in ASym]: T } & { [s in BSym]: T },
      number
    >
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).sort((a, b) =>
      this.compareFn.evaluate({
        [this.aSym]: a,
        [this.bSym]: b,
      })
    );
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.sort((a, b) => ${this.compareFn.toString(
      {
        [this.aSym]: "a",
        [this.bSym]: "b",
      }
    )})`;
  }
}
export function sort<Ctx, ASym extends symbol, BSym extends symbol, T>(
  expr: Expr<Ctx, T[]>,
  aSym: ASym,
  bSym: BSym,
  compareFn: Expr<{ [s in ASym]: T } & { [s in BSym]: T }, number>
): Expr<Ctx, T[]> {
  return new Sort(expr, aSym, bSym, compareFn);
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
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
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

class Cmp<Ctx> implements Expr<Ctx, number> {
  constructor(
    private readonly lhs: Expr<Ctx, number>,
    private readonly rhs: Expr<Ctx, number>
  ) {}
  evaluate(ctx: Ctx): number {
    return this.lhs.evaluate(ctx) - this.rhs.evaluate(ctx);
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `cmp(${this.lhs.toString(ctx)}, ${this.rhs.toString(ctx)})`;
  }
}
export function cmp<Ctx>(a: Expr<Ctx, number>, b: Expr<Ctx, number>) {
  return new Cmp(a, b);
}

function findMatching(str: string, pair: "[]" | "()", start: number): number {
  let level = 1;
  let stringExpr = false;
  for (let i = start; i >= 0; --i) {
    if (str[i] === `"`) {
      if (stringExpr) {
        if (str[i - 1] !== "\\") {
          stringExpr = false;
        }
      } else {
        stringExpr = true;
      }
    } else if (str[i] === pair[0]) {
      --level;
      if (level === 0) {
        return i;
      }
    } else if (str[i] === pair[1]) {
      ++level;
    }
  }
  return -1;
}

function lastIndexOf(str: string, needle: ",", start: number): number {
  let stringExpr = false;
  for (let i = start; i >= 0; --i) {
    if (str[i] === `"`) {
      if (stringExpr) {
        if (str[i - 1] !== "\\") {
          stringExpr = false;
        }
      } else {
        stringExpr = true;
      }
    } else if (str[i] === needle && !stringExpr) {
      return i;
    }
  }
  return -1;
}

export function fromString<Ctx extends { [s in string]: symbol }>(
  ctx: Ctx,
  str: string
): Expr<{ [s in Ctx[keyof Ctx]]: never }, never> {
  // TODO: Fully implement this
  if (str.endsWith("]")) {
    const bracketStart = findMatching(str, "[]", str.length - 2);
    if (bracketStart === -1) {
      throw Error("Matching bracket not found");
    }

    const key = JSON.parse(str.slice(bracketStart + 1, str.length - 1));
    const expr = fromString(ctx, str.slice(0, bracketStart));
    return prop(expr, key);
  } else if (str.endsWith(")")) {
    const parenStart = findMatching(str, "()", str.length - 2);
    if (parenStart === -1) {
      throw Error("Matching parenthesis not found");
    }

    const args = str.slice(parenStart + 1, str.length - 1);
    const func = str.slice(0, parenStart);
    if (func.endsWith(".sortBy")) {
      if (!args.startsWith("(v) => ")) {
        throw Error("invalid sortBy lambda");
      }
      const expr = fromString(
        ctx,
        func.slice(0, func.length - ".sortBy".length)
      );

      const vSym = Symbol("v");
      const lambdaExpr = fromString(
        {
          v: vSym,
        },
        args.slice("(v) => ".length)
      );
      return sortBy(expr, vSym, lambdaExpr) as Expr<
        { [s in Ctx[keyof Ctx]]: never },
        never
      >;
    }
  } else if (str in ctx) {
    return fromCtx(ctx[str]);
  }
  throw TypeError("Not implemented");
}
