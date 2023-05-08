import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Schema } from "../schema";
import { Source, SourceObject } from "../Source";

// TODO: docs
export type Selector<T extends SourceObject> = SelectorC<T> & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
} & {
  // TODO: considered this but couldn't get it to work:
  // fold<Tag extends string, U extends SelectorSource>(
  //   key: Tag,
  //   cases: {
  //     [key in T[Tag] & string]: (v: UnknownSelector<T>) => U;
  //   }
  // ): SelectorOf<U>;

  // TODO: decide whether we want to keep this, or remove deprecation
  /**
   *
   * @deprecated use is instead
   */
  fold<Tag extends string>(
    key: Tag
  ): <U extends SelectorSource>(cases: {
    [key in T[Tag] & string]: (v: UnknownSelector<T>) => U;
  }) => SelectorOf<U>;
};

export type OptionalSelector<T extends SourceObject | undefined> =
  SelectorC<T> & {
    readonly [key in keyof T]: UnknownSelector<NonNullable<T>[key] | undefined>;
  } & {
    // TODO: considered this but couldn't get it to work:
    // fold<Tag extends string, U extends SelectorSource>(
    //   key: Tag,
    //   cases: {
    //     [key in T[Tag] & string]: (v: UnknownSelector<T>) => U;
    //   }
    // ): SelectorOf<U>;

    // TODO: decide whether we want to keep this, or remove deprecation
    /**
     *
     * @deprecated use is instead
     */
    fold<Tag extends string>(
      key: Tag
    ): <U extends SelectorSource>(cases: {
      [key in NonNullable<T>[Tag] & string]: (v: UnknownSelector<T>) => U;
    }) => SelectorOf<U>;

    andThen<U extends SelectorSource>(
      f: (v: UnknownSelector<T>) => U
    ): SelectorOf<U>;
  };

// export type MatchRes<
//   T extends SourceObject,
//   Tag extends keyof T,
//   Cases extends {
//     [Value in T as Value[Tag] & string]: (
//       v: UndistributedSourceObject<Value>
//     ) => SelectorSource;
//   }
// > = Cases[T[Tag] & string] extends (v: any) => infer R
//   ? R extends SelectorSource
//     ? R
//     : never
//   : never;

// type Test<
//   T extends SourceObject,
//   Tag extends keyof T,
//   Cases extends {
//     [Value in T as Value[Tag] & string]: (
//       v: UndistributedSourceObject<Value>
//     ) => SelectorSource;
//   }
// > = Cases[T[Tag] & string] extends (v: any) => infer R
//   ? R extends SelectorSource
//     ? R
//     : never
//   : never;

// type T = Test<
//   { type: "foo"; foo: string } | { type: "bar"; bar: number },
//   "type",
//   {
//     foo: (v: Selector<{ type: "foo"; foo: string }>) => {
//       foo: UnknownSelector<string>;
//     };
//     bar: (v: Selector<{ type: "bar"; bar: number }>) => UnknownSelector<number>;
//   }
// >;
