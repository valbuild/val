import { result, array } from "../fp";

export class PatchError {
  constructor(public message: string) {}
}

export type ReadonlyJSONValue =
  | string
  | number
  | boolean
  | null
  | readonly ReadonlyJSONValue[]
  | {
      readonly [key: string]: ReadonlyJSONValue;
    };

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | {
      [key: string]: JSONValue;
    };

type ToMutableJSONArray<T extends readonly ReadonlyJSONValue[]> = {
  [P in keyof T]: ToMutable<T[P]>;
};
export type ToMutable<T extends ReadonlyJSONValue> = JSONValue extends T
  ? JSONValue
  : T extends readonly ReadonlyJSONValue[]
    ? ToMutableJSONArray<T>
    : T extends { readonly [key: string]: ReadonlyJSONValue }
      ? { -readonly [P in keyof T]: ToMutable<T[P]> }
      : T;

type ToReadonlyJSONArray<T extends readonly ReadonlyJSONValue[]> = {
  readonly [P in keyof T]: ToReadonly<T[P]>;
};
export type ToReadonly<T extends ReadonlyJSONValue> = JSONValue extends T
  ? ReadonlyJSONValue
  : T extends readonly ReadonlyJSONValue[]
    ? ToReadonlyJSONArray<T>
    : T extends { readonly [key: string]: ReadonlyJSONValue }
      ? { readonly [P in keyof T]: ToReadonly<T[P]> }
      : T;

/**
 * NOTE: MAY mutate the input document.
 */
export interface Ops<T, E> {
  add(
    document: T,
    path: string[],
    value: JSONValue,
  ): result.Result<T, E | PatchError>;
  remove(
    document: T,
    path: array.NonEmptyArray<string>,
  ): result.Result<T, E | PatchError>;
  replace(
    document: T,
    path: string[],
    value: JSONValue,
  ): result.Result<T, E | PatchError>;
  move(
    document: T,
    from: array.NonEmptyArray<string>,
    path: string[],
  ): result.Result<T, E | PatchError>;
  copy(
    document: T,
    from: string[],
    path: string[],
  ): result.Result<T, E | PatchError>;
  test(
    document: T,
    path: string[],
    value: JSONValue,
  ): result.Result<boolean, E | PatchError>;
  get(document: T, path: string[]): result.Result<JSONValue, E | PatchError>;
}
