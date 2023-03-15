export interface Lens<In, Out> {
  apply(input: In): Out;

  /**
   * @param input expression representing the input of the lens
   */
  toString(input: string): string;
}

export type InOf<T> = T extends Lens<infer In, unknown> ? In : never;
export type OutOf<T> = T extends Lens<unknown, infer Out> ? Out : never;

const _identity = new (class IdentityLens<T> implements Lens<T, T> {
  apply(input: T) {
    return input;
  }
  toString(input: string): string {
    return input;
  }
})();
export function identity<T>(): Lens<T, T> {
  return _identity as Lens<T, T>;
}

class PropLens<
  P extends PropertyKey,
  T extends { readonly [key in P]: unknown }
> implements Lens<T, T[P]>
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
): Lens<T, T[P]> {
  return new PropLens(key);
}

class FilterLens<T> implements Lens<readonly T[], T[]> {
  constructor(private readonly predicate: Lens<T, unknown>) {}
  apply(input: readonly T[]): T[] {
    return input.filter((item) => this.predicate.apply(item));
  }
  toString(input: string): string {
    return `${input}.filter((i) => ${this.predicate.toString("i")})`;
  }
}
export function filter<T>(predicate: Lens<T, unknown>): Lens<T[], T[]> {
  return new FilterLens(predicate);
}

class FindLens<T> implements Lens<T[], T | undefined> {
  constructor(private readonly predicate: Lens<T, unknown>) {}
  apply(input: T[]): T | undefined {
    return input.find((item) => this.predicate.apply(item));
  }
  toString(input: string): string {
    return `${input}.find((i) => ${this.predicate.toString("i")})`;
  }
}
export function find<T>(predicate: Lens<T, unknown>): Lens<T[], T | undefined> {
  return new FindLens(predicate);
}

class SliceLens<T> implements Lens<T[], T[]> {
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
export function slice<T>(start: number, end?: number): Lens<T[], T[]> {
  return new SliceLens(start, end);
}

class ComposeLens implements Lens<unknown, unknown> {
  constructor(readonly lenses: Lens<unknown, unknown>[]) {}
  apply(input: unknown): unknown {
    let current = input;
    for (const lens of this.lenses) {
      current = lens.apply(current);
    }
    return current;
  }
  toString(input: string): string {
    return this.lenses.reduce((input, lens) => lens.toString(input), input);
  }
}

export function compose<A, B, C>(ab: Lens<A, B>, bc: Lens<B, C>): Lens<A, C>;
export function compose<A, B, C, D>(
  ab: Lens<A, B>,
  bc: Lens<B, C>,
  cd: Lens<C, D>
): Lens<A, D>;
export function compose(
  ...lenses: Lens<unknown, unknown>[]
): Lens<unknown, unknown> {
  const filtered = lenses
    .filter((lens) => lens !== _identity)
    .flatMap((lens) => (lens instanceof ComposeLens ? lens.lenses : [lens]));
  if (filtered.length === 0) {
    return _identity;
  } else if (filtered.length === 1) {
    return filtered[0];
  } else {
    return new ComposeLens(lenses);
  }
}

class EqLens<T> implements Lens<T, boolean> {
  constructor(private readonly value: T) {}
  apply(input: T): boolean {
    // TODO: Implement deep equality
    return input === this.value;
  }
  toString(input: string): string {
    return `eq(${input}, ${JSON.stringify(this.value)})`;
  }
}
export function eq<T>(value: T): Lens<T, boolean> {
  return new EqLens(value);
}

class LocalizeLens<T> implements Lens<Record<"en_US", T>, T> {
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
  return new LocalizeLens<T>(locale);
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
): [source: string, lens: Lens<unknown, unknown>] {
  // TODO: Fully implement this
  if (str.endsWith("]")) {
    const bracketStart = findMatching(str, "[]", str.length - 2);
    if (bracketStart === -1) {
      throw Error("Invalid prop");
    }

    const expr = JSON.parse(str.slice(bracketStart + 1, str.length - 1));
    const [source, parentLens] = fromString(str.slice(0, bracketStart));
    return [source, compose(parentLens, prop(expr))];
  }
  return [str, identity()];
}
