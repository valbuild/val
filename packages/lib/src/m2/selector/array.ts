import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SourceArray,
} from ".";

declare const brand: unique symbol;

export type UndistributedSourceArray<T extends SourceArray> = [T] extends [
  infer U // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends SourceArray
    ? Selector<U>
    : never
  : never;

type Selector<T extends SourceArray> = SelectorC<T> & {
  readonly [key in keyof T & number]: UnknownSelector<T[key]>;
} & {
  readonly [brand]: "ArraySelector";
  readonly length: UnknownSelector<T["length"]>;
  filter(
    predicate: (v: UnknownSelector<T[number]>) => SelectorOf<boolean>
  ): SelectorOf<T>;
  map<U extends SelectorSource>(
    f: (v: UnknownSelector<T[number]>) => U
  ): SelectorOf<U[]>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U>;
};
