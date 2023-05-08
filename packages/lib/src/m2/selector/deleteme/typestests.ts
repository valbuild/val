/* eslint-disable @typescript-eslint/no-unused-vars */
import { Expr } from "../../expr/expr";
import { Val } from "../../val";

type SourcePrimitive = string | undefined;

type Source = SourcePrimitive | SourceObject | SourceArray;

type SourceObject = { [key in string]: Source } & {
  match?: never;
  andThen?: never;
  _ref?: never;
  _type?: never;
};
type SourceArray = readonly Source[];

export type SelectorSource =
  | {
      readonly [key: string | number]: SelectorSource;
    }
  | readonly SelectorSource[]
  | SourcePrimitive
  | SelectorC<Source>;

abstract class SelectorC<out T extends Source> {
  /**
   * @internal
   */
  constructor(
    protected readonly s?: T /* do not use this, we must have it to make type-checking (since classes are compared structurally?)  */
  ) {}
}

type SourceOf<T extends SelectorSource> = T extends SelectorC<infer S>
  ? S
  : [T] extends readonly [(infer S)[]]
  ? S extends SelectorSource
    ? readonly SourceOf<S>[]
    : never
  : T extends { [key: string]: SelectorSource }
  ? {
      [key in keyof T]: T[key] extends SelectorSource
        ? SourceOf<T[key]>
        : never;
    }
  : T extends Source
  ? T
  : never;

/**
 * Use this type to convert types that accepts both Source and Selectors
 *
 * An example would be where literals are supported like in most higher order functions (e.g. map in array)
 **/
export type SelectorOf<U extends SelectorSource> = [SourceOf<U>] extends [
  infer S extends Source
]
  ? UnknownSelector<S>
  : never;

type StringSelector<T extends string | undefined> = SelectorC<T>;

type UndefinedSelector<T extends undefined> = SelectorC<T>;

type UnknownSelector<T extends Source> = [T] extends [SourceObject]
  ? ObjectSelector<T>
  : [T] extends [SourceObject | undefined]
  ? ObjectSelectorOptional<T>
  : T extends string
  ? StringSelector<T>
  : T extends undefined
  ? UndefinedSelector<T>
  : never;

type AsSource<T> = T extends Source ? T : never;

// TODO: docs
type ObjectSelectorOptional<T extends SourceObject | undefined> =
  SelectorC<T> & {
    readonly [key in keyof T]: UnknownSelector<AsSource<T[key] | undefined>>;
  };

type ObjectSelector<T extends SourceObject> = SelectorC<T> & {
  readonly [key in keyof T]: UnknownSelector<AsSource<T[key]>>;
};

{
  const a = null as unknown as UnknownSelector<{
    foo: { bar: string } | undefined;
    zoo: string;
    boo: string | undefined;
  }>;
  a.foo;
  a.foo.bar;
  a.zoo;
  a.boo;
}
