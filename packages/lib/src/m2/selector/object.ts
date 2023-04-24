import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SourceObject,
} from ".";

declare const brand: unique symbol;
export type UndistributedSourceObject<T extends SourceObject> = [T] extends [
  SourceObject
]
  ? Selector<T>
  : never;

type Selector<T extends SourceObject> = SelectorC<T> & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
} & {
  readonly [brand]: "ObjectSelector";
  readonly match: <
    K extends keyof T,
    R extends SelectorSource,
    Cases extends {
      [Value in T as Value[K] & string]: (
        v: UndistributedSourceObject<Value>
      ) => R;
    }
  >(
    key: K,
    cases: Cases
  ) => Cases[T[K] & string] extends (v: any) => infer R
    ? R extends SelectorSource
      ? SelectorOf<R>
      : never
    : never;
};
