export interface Lens<In, Out> {
  apply(input: In): Out;
}

export type InOf<T> = T extends Lens<infer In, unknown> ? In : never;
export type OutOf<T> = T extends Lens<unknown, infer Out> ? Out : never;

const _identity = new (class IdentityLens<T> implements Lens<T, T> {
  apply(input: T) {
    return input;
  }
  modify(_prevIn: T, out: T) {
    return out;
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
}
export function filter<T>(predicate: Lens<T, unknown>): Lens<T[], T[]> {
  return new FilterLens(predicate);
}

class FindLens<T> implements Lens<T[], T | undefined> {
  constructor(private readonly predicate: Lens<T, unknown>) {}
  apply(input: T[]): T | undefined {
    return input.find((item) => this.predicate.apply(item));
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
}
export function slice<T>(start: number, end?: number): Lens<T[], T[]> {
  return new SliceLens(start, end);
}

class ComposeLens implements Lens<unknown, unknown> {
  constructor(private readonly lenses: Lens<unknown, unknown>[]) {}
  apply(input: unknown): unknown {
    let current = input;
    for (const lens of this.lenses) {
      current = lens.apply(current);
    }
    return current;
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
  const filtered = lenses.filter((lens) => lens !== _identity);
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
}
export function eq<T>(value: T): Lens<T, boolean> {
  return new EqLens(value);
}

class LocalizeLens<T> implements Lens<Record<"en_US", T>, T> {
  constructor(private readonly locale?: "en_US") {}
  apply(input: Record<"en_US", T>): T {
    return input[this.locale ?? "en_US"];
  }
}

export function localize<T>(locale?: "en_US") {
  return new LocalizeLens<T>(locale);
}
