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

// @ts-expect-error these signatures are actually compatible
export function map<T, U>(
  fn: (value: T, index: number, array: ReadonlyNonEmptyArray<T>) => U
): (array: ReadonlyNonEmptyArray<T>) => NonEmptyArray<U>;
export function map<T, U>(
  fn: (value: T, index: number, array: ReadonlyArray<T>) => U
): (array: ReadonlyArray<T>) => Array<U> {
  return (array) => array.map(fn);
}
