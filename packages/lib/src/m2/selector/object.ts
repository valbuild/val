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
  match<
    Tag extends keyof T,
    R extends SelectorSource,
    Cases extends {
      [Value in T as Value[Tag] & string]: (
        v: UndistributedSourceObject<Value>
      ) => R;
    }
  >(
    key: Tag,
    cases: Cases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Cases[T[Tag] & string] extends (v: any) => infer R
    ? R extends SelectorSource
      ? SelectorOf<R>
      : never
    : never;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<T>) => U
  ): SelectorOf<U>;
};
