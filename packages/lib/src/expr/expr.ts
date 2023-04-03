import { formatJSONPointerReferenceToken } from "../patch/parse";
import { lastIndexOf, split, lastIntegerOf, isDigit } from "./strings";
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
 * For derived object values such as those produced by mapping, the Ref may be an
 * object of Refs describing the value of each property of the object.
 *
 * For other expressions such as literals and those consisting of arithmetic
 * operations, the Ref is null and its value is not assignable.
 */
export type Ref = { [p in string]: Ref } | Ref[] | string | null;
export type ValueAndRef<T> = readonly [value: T, ref: Ref];

export function isAssignable(ref: Ref): ref is string {
  return typeof ref === "string";
}

function propRef<P extends PropertyKey>(ref: Ref, prop: P): Ref {
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
    return [value[this.key], propRef(ref, this.key)];
  }
  toString(ctx: { readonly [s in keyof Ctx]: string }): string {
    return `${this.expr.toString(ctx)}.${JSON.stringify(this.key)}`;
  }
}
export function prop<Ctx, T extends Record<string, unknown>, P extends keyof T>(
  expr: Expr<Ctx, T>,
  key: P
): Expr<Ctx, T[P]> {
  return new Prop(expr, key);
}
/**
 * Alias for {@link prop}
 */
export function item<Ctx, T>(
  expr: Expr<Ctx, readonly T[]>,
  key: number
): Expr<Ctx, T> {
  if (!Number.isInteger(key) || key < 0) {
    throw Error("Key must be a positive integer");
  }
  return new Prop(
    expr,
    key +
      0 /* -0 is possible, but we do not want to parse -0, so we transform -0 => 0 by adding 0 */
  );
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
        resRef.push(propRef(ref, i));
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

class Find<Ctx, T> implements Expr<Ctx, T | null> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly predicate: Expr<readonly [T], unknown>
  ) {}
  evaluate(ctx: Ctx): T | null {
    return (
      this.expr.evaluate(ctx).find((item) => this.predicate.evaluate([item])) ??
      null
    );
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T | null> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const idx = value.findIndex((item) => this.predicate.evaluate([item]));
    if (idx === -1) {
      return [null, null];
    }
    return [value[idx], propRef(ref, idx)];
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
): Expr<Ctx, T | null> {
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
    const retRef = retValue.map((_item, i) => propRef(ref, this.start + i));
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
        resRef.push(propRef(ref, i));
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
        resRef.push(propRef(ref, i));
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

class Map<Ctx, T, U> implements Expr<Ctx, U[]> {
  constructor(
    private readonly expr: Expr<Ctx, readonly T[]>,
    private readonly callback: Expr<readonly [T, number], U>
  ) {}
  evaluate(ctx: Ctx): U[] {
    return this.expr
      .evaluate(ctx)
      .map((v, i) => this.callback.evaluate([v, i]));
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<U[]> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    const resValue: U[] = [];
    const resRef: Ref[] = [];
    value.forEach((v, i) => {
      const [itemValue, itemRef] = this.callback.evaluateRef(
        [v, i],
        [propRef(ref, i), null]
      );
      resValue.push(itemValue);
      resRef.push(itemRef);
    });
    return [resValue, resRef];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `${this.expr.toString(ctx)}.map((v, i) => ${this.callback.toString([
      "v",
      "i",
    ])})`;
  }
}
export function map<Ctx, T, U>(
  expr: Expr<Ctx, readonly T[]>,
  callback: Expr<readonly [T, number], U>
): Expr<Ctx, U[]> {
  return new Map(expr, callback);
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

class AndThen<Ctx, T, U> implements Expr<Ctx, U | null> {
  constructor(
    private readonly expr: Expr<Ctx, T | null>,
    private readonly callback: Expr<readonly [T], U | null>
  ) {}
  evaluate(ctx: Ctx): U | null {
    const value = this.expr.evaluate(ctx);
    if (value === null) {
      return null;
    }
    return this.callback.evaluate([value]);
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<U | null> {
    const [value, ref] = this.expr.evaluateRef(ctx, refCtx);
    if (value === null) {
      // TODO: Figure out if it makes sense to return the underlying ref in case
      // the value is null
      return [null, ref];
    }
    return this.callback.evaluateRef([value], [ref]);
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    console.log(this.callback);
    return `${this.expr.toString(ctx)}.andThen((v) => ${this.callback.toString([
      "v",
    ])})`;
  }
}
export function andThen<Ctx, T, U>(
  expr: Expr<Ctx, T | null>,
  callback: Expr<readonly [T], U | null>
): Expr<Ctx, U | null> {
  return new AndThen(expr, callback);
}

class PrimitiveLiteral<Ctx, T extends string | number | boolean | null>
  implements Expr<Ctx, T>
{
  constructor(private readonly value: T) {}
  evaluate(): T {
    return this.value;
  }
  evaluateRef(): ValueAndRef<T> {
    return [this.value, null];
  }
  toString(): string {
    if (typeof this.value === "string") {
      return JSON.stringify(this.value);
    }
    return `<${JSON.stringify(this.value)}>`;
  }
}

export function primitiveLiteral<
  Ctx,
  T extends string | number | boolean | null
>(value: T): Expr<Ctx, T> {
  return new PrimitiveLiteral(value);
}

class ObjectLiteral<Ctx, T extends { [p in string]: unknown }>
  implements Expr<Ctx, T>
{
  constructor(private readonly props: { [p in keyof T]: Expr<Ctx, T[p]> }) {}
  evaluate(ctx: Ctx): T {
    return Object.fromEntries(
      Object.entries(this.props).map(
        ([prop, expr]: [string, Expr<Ctx, T[string]>]) => [
          prop,
          expr.evaluate(ctx),
        ]
      )
    ) as T;
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T> {
    const valueEntries: [prop: string, value: T[string]][] = [];
    const refEntries: [prop: string, ref: Ref][] = [];

    Object.entries(this.props).forEach(
      ([prop, expr]: [string, Expr<Ctx, T[string]>]) => {
        const [value, ref] = expr.evaluateRef(ctx, refCtx);
        valueEntries.push([prop, value]);
        refEntries.push([prop, ref]);
      }
    );

    return [
      Object.fromEntries(valueEntries) as T,
      Object.fromEntries(refEntries),
    ];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `{${Object.entries(this.props)
      .map(
        ([prop, expr]: [string, Expr<Ctx, T[string]>]) =>
          `${JSON.stringify(prop)}: ${expr.toString(ctx)}`
      )
      .join(", ")}}`;
  }
}
export function objectLiteral<
  Ctx,
  T extends { [p in string]: unknown }
>(props: { [p in keyof T]: Expr<Ctx, T[p]> }): Expr<Ctx, T> {
  return new ObjectLiteral(props);
}

class ArrayLiteral<Ctx, T extends readonly unknown[]> implements Expr<Ctx, T> {
  constructor(private readonly items: { [i in keyof T]: Expr<Ctx, T[i]> }) {}
  evaluate(ctx: Ctx): T {
    return this.items.map((expr) => expr.evaluate(ctx)) as unknown as T;
  }
  evaluateRef(ctx: Ctx, refCtx: RefCtx<Ctx>): ValueAndRef<T> {
    const value: T[number][] = [];
    const ref: Ref[] = [];
    for (const expr of this.items) {
      const [itemValue, itemRef] = expr.evaluateRef(ctx, refCtx);
      value.push(itemValue);
      ref.push(itemRef);
    }
    return [value as unknown as T, ref];
  }
  toString(ctx: ToStringCtx<Ctx>): string {
    return `[${this.items.map((item) => item.toString(ctx)).join(", ")}]`;
  }
}
export function arrayLiteral<Ctx, T extends readonly unknown[]>(items: {
  [p in keyof T]: Expr<Ctx, T[p]>;
}): Expr<Ctx, T> {
  return new ArrayLiteral<Ctx, T>(items);
}
export function parse<Ctx>(
  ctx: { readonly [s in string]: keyof Ctx },
  str: string
): Expr<Ctx, unknown> {
  // TODO: Fully implement this
  // Currently missing: sub, map
  if (str.endsWith("}")) {
    const bracketStart = lastIndexOf(str, "{");
    if (bracketStart === -1) {
      throw Error(`Matching opening bracket ('{') not found in object: ${str}`);
    }
    if (bracketStart !== 0) {
      throw Error("Object literal must be an isolated expression");
    }

    if (str === "{}") {
      return objectLiteral({});
    }

    const entries = split(str.slice(1, str.length - 1), ", ").map(
      (entryStr) => {
        const parts = split(entryStr, ": ");
        if (parts.length !== 2) {
          throw Error(`Invalid object literal entry: ${entryStr}`);
        }
        const [keyStr, valueStr] = parts;

        const key = JSON.parse(keyStr);
        if (typeof key !== "string") {
          throw Error(
            `Object literal key must be a string literal, got: ${keyStr}`
          );
        }
        const value = parse(ctx, valueStr);
        return [key, value] as const;
      }
    );
    return objectLiteral(Object.fromEntries(entries));
  } else if (str.endsWith("]")) {
    const bracketStart = lastIndexOf(str, "[");
    if (bracketStart === -1) {
      throw Error(
        `Matching opening square bracket ('[') not found in array: ${str}`
      );
    }
    if (bracketStart !== 0) {
      throw Error("Array literal must be an isolated expression");
    }

    if (str === "[]") {
      return arrayLiteral([]);
    }

    const items = split(str.slice(1, str.length - 1), ", ").flatMap((item) =>
      parse(ctx, item)
    );
    return arrayLiteral(items);
  } else if (str.endsWith('"')) {
    const stringLiteralStart = lastIndexOf(str, '"');
    if (stringLiteralStart === -1) {
      throw Error(`Matching opening quote (") not found in string: ${str}`);
    }
    const stringLiteral = JSON.parse(str.slice(stringLiteralStart, str.length));
    if (typeof stringLiteral !== "string") {
      throw Error(
        `Expected string literal (${stringLiteral}) to be of type string, but found: ${typeof stringLiteral}`
      );
    }
    const isPropertyAccess = str[stringLiteralStart - 1] === ".";
    if (isPropertyAccess) {
      const expr = parse(ctx, str.slice(0, stringLiteralStart - 1)) as Expr<
        Ctx,
        { [s in typeof stringLiteral]: unknown }
      >;
      return prop(expr, stringLiteral);
    } else {
      if (stringLiteralStart === 0) {
        return primitiveLiteral(JSON.parse(str));
      } else {
        throw Error(
          `String literal must be an isolated expression. Got: ${str}`
        );
      }
    }
  } else if (str.endsWith(">")) {
    const primitiveLiteralStart = str.lastIndexOf("<");
    if (primitiveLiteralStart === -1) {
      throw Error(`Matching start of literal (<) not found in value: ${str}`);
    } else if (primitiveLiteralStart !== 0) {
      throw Error("Primitive literal must be an isolated expression");
    }
    const value = JSON.parse(str.slice(1, str.length - 1));
    if (typeof value === "string") {
      throw Error(
        "Unexpected string literal inside a primitive literal of non-string type"
      );
    }
    return primitiveLiteral(value);
  } else if (isDigit(str.slice(-1))) {
    const integerLiteralStart = lastIntegerOf(str);
    const integerLiteral = Number(str.slice(integerLiteralStart, str.length));
    const isPropertyAccess = str[integerLiteralStart - 1] === ".";
    if (!isPropertyAccess) {
      throw Error("Found a integer literal ");
    }
    const expr = parse(ctx, str.slice(0, integerLiteralStart - 1)) as Expr<
      Ctx,
      { [s in typeof integerLiteral]: unknown }
    >;
    return prop(expr, integerLiteral);
  } else if (str.endsWith(")")) {
    const parenStart = lastIndexOf(str, "(");
    if (parenStart === -1) {
      throw Error("Matching opening parenthesis ('(') not found");
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
    } else if (funcStr.endsWith(".map")) {
      if (!argsStr.startsWith("(v, i) => ")) {
        throw Error("invalid map lambda");
      }

      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".map".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const callbackFn = parse<readonly [unknown, number]>(
        {
          v: 0,
          i: 1,
        },
        argsStr.slice("(v, i) => ".length)
      ) as Expr<readonly [unknown, number], number>;

      return map(expr, callbackFn);
    } else if (funcStr.endsWith(".andThen")) {
      if (!argsStr.startsWith("(v) => ")) {
        throw Error("invalid find lambda");
      }

      const expr = parse(
        ctx,
        funcStr.slice(0, funcStr.length - ".andThen".length)
      ) as Expr<Ctx, readonly unknown[]>;
      const callback = parse<readonly [unknown]>(
        {
          v: 0,
        },
        argsStr.slice("(v) => ".length)
      );
      return andThen(expr, callback);
    }
  } else if (str in ctx) {
    return fromCtx(ctx[str]);
  }
  throw TypeError(`Not implemented, unable to parse: ${str}`);
}
