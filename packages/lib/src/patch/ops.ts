import { result, array } from "../fp";

export class PatchError {
  constructor(public message: string) {}
}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | {
      [key: string]: JSONValue;
    };

/**
 * NOTE: MAY mutate the input document.
 */
export interface Ops<T, E> {
  add(
    document: T,
    path: string[],
    value: JSONValue
  ): result.Result<T, E | PatchError>;
  remove(
    document: T,
    path: array.NonEmptyArray<string>
  ): result.Result<T, E | PatchError>;
  replace(
    document: T,
    path: string[],
    value: JSONValue
  ): result.Result<T, E | PatchError>;
  move(
    document: T,
    from: array.NonEmptyArray<string>,
    path: string[]
  ): result.Result<T, E | PatchError>;
  copy(
    document: T,
    from: string[],
    path: string[]
  ): result.Result<T, E | PatchError>;
  test(
    document: T,
    path: string[],
    value: JSONValue
  ): result.Result<boolean, E | PatchError>;
}
