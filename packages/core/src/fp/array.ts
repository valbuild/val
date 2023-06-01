export type NonEmptyArray<T> = [T, ...T[]];
export type ReadonlyNonEmptyArray<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(array: Array<T>): array is NonEmptyArray<T>;
export function isNonEmpty<T>(
  array: ReadonlyArray<T>
): array is ReadonlyNonEmptyArray<T> {
  return array.length > 0;
}

export function flatten<T>(
  array: ReadonlyNonEmptyArray<ReadonlyNonEmptyArray<T>>
): NonEmptyArray<T>;
export function flatten<T>(array: ReadonlyArray<ReadonlyArray<T>>): Array<T> {
  return array.flat(1);
}

export function map<T, U>(
  fn: (value: T, index: number) => U
): {
  (array: ReadonlyArray<T>): Array<U>;
  (array: ReadonlyNonEmptyArray<T>): NonEmptyArray<U>;
} {
  function mapFn(array: ReadonlyArray<T>): Array<U>;
  function mapFn(array: ReadonlyNonEmptyArray<T>): NonEmptyArray<U>;
  function mapFn(array: ReadonlyArray<T>): Array<U> {
    return array.map(fn);
  }
  return mapFn;
}
