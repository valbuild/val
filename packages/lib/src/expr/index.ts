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

class FromCtx<S extends PropertyKey, T>
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
export function fromCtx<S extends PropertyKey, T>(
  sym: S
): Expr<{ readonly [s in S]: T }, T> {
  return new FromCtx(sym);
}

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

class Filter<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly predicate: Expr<readonly [T], unknown>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr.evaluate(ctx).filter((item) => {
      return this.predicate.evaluate([item]);
    });
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.filter((v) => ${this.predicate.toString([
      "v",
    ])})`;
  }
}
export function filter<Ctx, T>(
  expr: Expr<Ctx, T[]>,
  predicate: Expr<readonly [T], unknown>
): Expr<Ctx, T[]> {
  return new Filter(expr, predicate);
}

class Find<Ctx, T> implements Expr<Ctx, T | undefined> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly predicate: Expr<readonly [T], unknown>
  ) {}
  evaluate(ctx: Ctx): T | undefined {
    return this.expr
      .evaluate(ctx)
      .find((item) => this.predicate.evaluate([item] as const));
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.find((v) => ${this.predicate.toString([
      "v",
    ])})`;
  }
}
export function find<Ctx, T>(
  expr: Expr<Ctx, T[]>,
  predicate: Expr<readonly [T], unknown>
): Expr<Ctx, T | undefined> {
  return new Find(expr, predicate);
}

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

class SortBy<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly keyFn: Expr<readonly [T], number>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr
      .evaluate(ctx)
      .sort((a, b) => this.keyFn.evaluate([a]) - this.keyFn.evaluate([b]));
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.sortBy((v) => ${this.keyFn.toString([
      "v",
    ])})`;
  }
}
export function sortBy<Ctx, T>(
  expr: Expr<Ctx, T[]>,
  keyFn: Expr<readonly [T], number>
): Expr<Ctx, T[]> {
  return new SortBy(expr, keyFn);
}

class Sort<Ctx, T> implements Expr<Ctx, T[]> {
  constructor(
    private readonly expr: Expr<Ctx, T[]>,
    private readonly compareFn: Expr<readonly [T, T], number>
  ) {}
  evaluate(ctx: Ctx): T[] {
    return this.expr
      .evaluate(ctx)
      .sort((a, b) => this.compareFn.evaluate([a, b]));
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.sort((a, b) => ${this.compareFn.toString(
      ["a", "b"]
    )})`;
  }
}
export function sort<Ctx, T>(
  expr: Expr<Ctx, T[]>,
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

export function parse<Ctx>(
  ctx: { [s in string]: keyof Ctx },
  str: string
): Expr<Ctx, never> {
  // TODO: Fully implement this
  if (str.endsWith("]")) {
    const bracketStart = findMatching(str, "[]", str.length - 2);
    if (bracketStart === -1) {
      throw Error("Matching bracket not found");
    }

    const key = JSON.parse(str.slice(bracketStart + 1, str.length - 1));
    const expr = parse(ctx, str.slice(0, bracketStart));
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
      const expr = parse(ctx, func.slice(0, func.length - ".sortBy".length));

      const keyFn = parse<readonly [never]>(
        {
          v: 0,
        },
        args.slice("(v) => ".length)
      );
      return sortBy(expr, keyFn) as Expr<Ctx, never>;
    } else if (func.endsWith(".filter")) {
      if (!args.startsWith("(v) => ")) {
        throw Error("invalid filter lambda");
      }
      const expr = parse(ctx, func.slice(0, func.length - ".filter".length));

      const predicate = parse<readonly [never]>(
        {
          v: 0,
        },
        args.slice("(v) => ".length)
      );
      return filter(expr, predicate) as Expr<Ctx, never>;
    } else if (func.endsWith(".find")) {
      if (!args.startsWith("(v) => ")) {
        throw Error("invalid find lambda");
      }

      const expr = parse(ctx, func.slice(0, func.length - ".find".length));
      const predicate = parse<readonly [never]>(
        {
          v: 0,
        },
        args.slice("(v) => ".length)
      );
      return find(expr, predicate) as Expr<Ctx, never>;
    }
  } else if (str in ctx) {
    return fromCtx(ctx[str]);
  }
  throw TypeError("Not implemented");
}
