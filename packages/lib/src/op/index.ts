export interface Op<In, Out> {
  apply(input: In): Out;

  /**
   * @param input expression representing the input of the op
   */
  toString(input: string): string;
}

export type InOf<T> = T extends Op<infer In, unknown> ? In : never;
export type OutOf<T> = T extends Op<unknown, infer Out> ? Out : never;

const _identity = new (class Identity<T> implements Op<T, T> {
  apply(input: T) {
    return input;
  }
  toString(input: string): string {
    return input;
  }
})();
export function identity<T>(): Op<T, T> {
  return _identity as Op<T, T>;
}

class Prop<P extends PropertyKey, T extends { readonly [key in P]: unknown }>
  implements Op<T, T[P]>
{
  constructor(private readonly key: P) {}
  apply(input: T): T[P] {
    return input[this.key];
  }
  toString(input: string): string {
    return `${input}[${JSON.stringify(this.key)}]`;
  }
}
export function prop<P extends PropertyKey, T extends { [key in P]: unknown }>(
  key: P
): Op<T, T[P]> {
  return new Prop(key);
}

class Filter<T> implements Op<readonly T[], T[]> {
  constructor(private readonly predicate: Op<T, unknown>) {}
  apply(input: readonly T[]): T[] {
    return input.filter((item) => this.predicate.apply(item));
  }
  toString(input: string): string {
    return `${input}.filter((i) => ${this.predicate.toString("i")})`;
  }
}
export function filter<T>(predicate: Op<T, unknown>): Op<T[], T[]> {
  return new Filter(predicate);
}

class Find<T> implements Op<T[], T | undefined> {
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
}

class Slice<T> implements Op<T[], T[]> {
  constructor(private readonly start: number, private readonly end?: number) {}
  apply(input: T[]): T[] {
    return input.slice(this.start, this.end);
  }
  toString(input: string): string {
    return `${input}.slice(${[this.start, this.end]
      .filter((item) => item !== undefined)
      .join(", ")})`;
  }
}
export function slice<T>(start: number, end?: number): Op<T[], T[]> {
  return new Slice(start, end);
}

class Compose implements Op<unknown, unknown> {
  constructor(readonly ops: Op<unknown, unknown>[]) {}
  apply(input: unknown): unknown {
    let current = input;
    for (const op of this.ops) {
      current = op.apply(current);
    }
    return current;
  }
  toString(input: string): string {
    return this.ops.reduce((input, op) => op.toString(input), input);
  }
}

export function compose<A, B, C>(ab: Op<A, B>, bc: Op<B, C>): Op<A, C>;
export function compose<A, B, C, D>(
  ab: Op<A, B>,
  bc: Op<B, C>,
  cd: Op<C, D>
): Op<A, D>;
export function compose(...ops: Op<unknown, unknown>[]): Op<unknown, unknown> {
  const filtered = ops
    .filter((op) => op !== _identity)
    .flatMap((op) => (op instanceof Compose ? op.ops : [op]));
  if (filtered.length === 0) {
    return _identity;
  } else if (filtered.length === 1) {
    return filtered[0];
  } else {
    return new Compose(ops);
  }
}

class Eq<T> implements Op<T, boolean> {
  constructor(private readonly value: T) {}
  apply(input: T): boolean {
    // TODO: Implement deep equality
    return input === this.value;
  }
  toString(input: string): string {
    return `eq(${input}, ${JSON.stringify(this.value)})`;
  }
}
export function eq<T>(value: T): Op<T, boolean> {
  return new Eq(value);
}

class Localize<T> implements Op<Record<"en_US", T>, T> {
  constructor(private readonly locale?: "en_US") {}
  apply(input: Record<"en_US", T>): T {
    return input[this.locale ?? "en_US"];
  }
  toString(input: string): string {
    return `${input}.localize(${
      this.locale !== undefined ? JSON.stringify(this.locale) : ""
    })`;
  }
}

export function localize<T>(locale?: "en_US") {
  return new Localize<T>(locale);
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

export function fromString(
  str: string
): [source: string, op: Op<unknown, unknown>] {
  // TODO: Fully implement this
  if (str.endsWith("]")) {
    const bracketStart = findMatching(str, "[]", str.length - 2);
    if (bracketStart === -1) {
      throw Error("Invalid prop");
    }

    const expr = JSON.parse(str.slice(bracketStart + 1, str.length - 1));
    const [source, parentOp] = fromString(str.slice(0, bracketStart));
    return [source, compose(parentOp, prop(expr))];
  }
  return [str, identity()];
}
