import { Expr } from "../expr/expr";
import { Val } from "../val";

type SourcePrimitive = string | undefined;

type Source = SourcePrimitive | SourceObject | SourceArray;

type SourceObject = { [key in string]: Source } & {
  match?: never;
  andThen?: never;
  _ref?: never;
  _type?: never;
};
type SourceArray = readonly Source[];

export type UnknownSelector<T extends Source> = // NOTE: the "un-distribution of the conditional type is important for selectors:
  // https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
  // NOTE: working with selectors might give you: "Type instantiation is excessively deep and possibly infinite." errors.
  // Have a look here for tips to helping solve it: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
  Source extends T
    ? SelectorC<T>
    : [T] extends [SourceObject | undefined]
    ? ObjectSelector<T>
    : [T] extends [SourceArray | undefined]
    ? ArraySelector<T>
    : [T] extends [string | undefined]
    ? StringSelector<T>
    : never;

export type SelectorSource =
  | {
      readonly [key: string | number]: SelectorSource;
    }
  | readonly SelectorSource[]
  | SourcePrimitive
  | SelectorC<Source>;

/**
 * @internal
 */
export const VAL_OR_EXPR = Symbol("getValOrExpr");
/**
 * @internal
 */
export const SCHEMA = Symbol("getSchema");

/**
 * @internal
 */
abstract class SelectorC<out T extends Source> {
  /**
   * @internal
   */
  constructor(
    protected valOrExpr: any,
    // TODO: this is the actual type, but it is hard to use in the implementations - this is internal so any is ok?
    // | Val<Source> /* Val<T> makes the type-checker confused, we do not really know why */
    // | Expr,
    protected readonly __fakeField?: T /* do not use this, we must have it to make type-checking (since classes are compared structurally?)  */
  ) {}
}

export interface AsVal<T extends Source> {
  /**
   * @internal
   */
  [VAL_OR_EXPR](): Expr;
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

type StringSelector<T extends string | undefined> = SelectorC<T> & {
  andThen<U extends SelectorSource>(
    f: (v: StringSelector<string>) => U
  ): SelectorOf<U> | StringSelector<string>;
  eq(other: T): SelectorOf<"todoboolean">;
};

type ArraySelector<T extends SourceArray | undefined> = ArraySelectorT<T>;

// TODO: docs
type ArraySelectorT<T extends SourceArray | undefined> = SelectorC<T> & {
  readonly [key in keyof T & number]: T[key] extends SourceArray
    ? UnknownSelector<T[key]>
    : ArraySelectorT<undefined>;
} & {
  map<U extends SelectorSource>(
    f: (
      v: T extends SourceArray
        ? UnknownSelector<T[number]>
        : ArraySelectorT<undefined>
    ) => U
  ): SelectorOf<U[]>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U>;
};

type ObjectSelector<T extends SourceObject | undefined> = [T] extends [
  SourceObject | undefined
]
  ? ObjectSelectorT<T>
  : never;

// TODO: docs
type ObjectSelectorT<T extends SourceObject | undefined> = SelectorC<T> & {
  readonly [key in keyof T]: [T] extends [SourceObject | undefined]
    ? T[key] | undefined extends Source
      ? UnknownSelector<T[key] | undefined>
      : T[key] extends Source
      ? UnknownSelector<T[key]>
      : never
    : never;
} & {
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): [T] extends [SourceObject | undefined]
    ? SelectorOf<U | undefined>
    : SelectorOf<U>;
};

{
  const a = null as unknown as UnknownSelector<
    Record<string, "foo"> | undefined
  >;
  const b = a.andThen((v) => {
    const b = v["a"];
    return b;
  });
}

{
  const a = null as unknown as UnknownSelector<["1", "b"]>;
  const b = a[0];
}
