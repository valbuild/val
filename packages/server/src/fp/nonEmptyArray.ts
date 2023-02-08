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
): NonEmptyArray<T> {
  return array.flat(1) as NonEmptyArray<T>;
}
