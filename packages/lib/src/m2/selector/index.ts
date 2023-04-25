/* eslint-disable @typescript-eslint/no-unused-vars */

import { I18n, I18nSelector } from "./i18n";
import { UndistributedSourceObject as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as PrimitiveSelector } from "./primitive";
import { OptionalSelector as OptionalSelector } from "./optional";
import { AssetSelector } from "./asset";

export type SourceObject = { [key in string]: Source };
export type SourceArray = Source[];
export type SourcePrimitive = string | number | boolean | undefined;

declare const brand: unique symbol;

export const FILE_REF_PROP = "_ref" as const;
export type FileSource<Ref extends string> = {
  readonly [FILE_REF_PROP]: Ref;
  readonly _type: "file"; // TODO: type is a very common property name, does that matter here?
  readonly [brand]: "ValFileSource";
};

export const REMOTE_REF_PROP = "_ref" as const; // TODO: same as FILE_REF_PROP so use same prop?
export type RemoteSource<Ref extends string> = {
  readonly [REMOTE_REF_PROP]: Ref;
  readonly _type: "remote"; // TODO: type is a very common property name, does that matter here?
  readonly [brand]: "ValRemoteSource";
};

export type Source =
  | SourcePrimitive
  | SourceObject
  | SourceArray
  | FileSource<string>;

export type SelectorSource =
  | {
      [key: string]: SelectorSource;
    }
  | SelectorSource[]
  | SourcePrimitive
  | SelectorC<SelectorSource>;

// NOTE: the "un-distribution of the conditional type is important here:
// https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
// Without it we get: Type instantiation is excessively deep and possibly infinite.
// Although we believe we understand this pattern, we do not really understand why it helps here.
// We believe it is the infer that is helping here: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437

export class SelectorC<T> {
  constructor(public readonly value: T) {}
}

export type Selector<T> = [T] extends [I18n<infer S> | undefined]
  ? I18nSelector<NonNullable<S>> | OptionalSelector<T>
  : [T] extends [FileSource<string> | undefined]
  ? AssetSelector | OptionalSelector<T>
  : [T] extends [SourceObject | undefined]
  ? ObjectSelector<NonNullable<T>> | OptionalSelector<T>
  : [T] extends [SourceArray | undefined]
  ? ArraySelector<NonNullable<T>> | OptionalSelector<T>
  : [T] extends [string | boolean | number | undefined]
  ? PrimitiveSelector<NonNullable<T>> | OptionalSelector<T>
  : never;

export type SourceOf<T> = [T] extends [SelectorC<infer S>]
  ? S
  : [T] extends [unknown[]]
  ? SourceOf<T[number]>[]
  : [T] extends [{ [key: string]: unknown }]
  ? {
      [key in keyof T]: SourceOf<T[key]>;
    }
  : T;

export type SelectorOf<U extends SelectorSource> = Selector<SourceOf<U>>;

{
  const ex = "" as unknown as Selector<string>;
  ex.andThen((v) => v);
  ex.eq("");
}

{
  const ex = "" as unknown as Selector<string | undefined>;
  const a = ex.andThen((v) => v);
  ex.eq("");
}

{
  const ex = "" as unknown as Selector<{ bar: string } | undefined>;
  ex;
}

{
  const ex = "" as unknown as Selector<
    { title: string; bar: string | undefined }[]
  >;
  const out = ex.map((v) => v);
  out[0].bar;
}

{
  const ex = "" as unknown as Selector<
    ({ title: string; bar: string } | undefined)[]
  >;
  const out = ex.map((v) => v);
  out[0];
}

{
  const ex = "" as unknown as Selector<
    { title: string; bar: { foo: string } | undefined }[]
  >;
  type A = SourceOf<{ title: string; bar: { foo: string } | undefined }[]>;
  const out = ex.map((v) => v);
  const a = out[0].bar;
}

{
  const ex = "" as unknown as Selector<FileSource<string>>;
  ex.url.eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
  const out = ex.map((v) => v);
  out[0].title;
  out[0].title.eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string }[]>;
  const out = ex.filter((v) => v.title.eq(""));
  out[0].title;
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
  type A = Selector<
    SourceOf<
      ObjectSelector<{
        readonly title: string;
        readonly bar: string;
      }>
    >
  >;
  const out = ex.map((v) => v);
  out[0].title;
  out[0].title.eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
  type A = SourceOf<{
    subTitle: PrimitiveSelector<string>;
  }>;
  const out = ex.map((v) => ({
    subTitle: v.title,
  }));
  out[0].subTitle;
  out[0].subTitle.eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
  const out = ex.map((v) => [v.title, v.title]);
  out[0][0].eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;

  type A = SourceOf<{
    title: {
      foo: string;
    };
    subTitle: {
      bar: PrimitiveSelector<string>;
    };
  }>;
  const out = ex.map((v) => ({
    title: {
      foo: "string",
    },
    subTitle: { bar: v.title },
  }));
  out[0].title.foo.eq("fdso");
}

{
  const ex = "" as unknown as Selector<
    {
      title: {
        foo: {
          inner: { innerInnerTitle: { even: { more: string } } }[];
        };
      };
      bar: string;
      many: string[];
      props: string;
      are: string;
      here: { even: { more: string } };
      for: string;
      testing: string;
      purposes: string;
      and: string;
      to: string;
      make: string;
      sure: string;
      that: {
        even: {
          more: {
            even: { more: { even: { more: { even: { more: string } } } } }[];
          };
        };
      };
      the: string;
      type: string;
      system: string;
      works: string;
      as: string;
      expected: string;
    }[]
  >;
  const out = ex.map((v) => ({
    title: {
      foo: "string",
    },
    subTitle: { bar: v },
  }));
  out[0].subTitle.bar.that.even.more.even[0].more.even.more.even.more.eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
  const out = ex.map((v) => ({ title: { foo: undefined } }));
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
  const out = ex.map((v) => ({ title1: v.title }));
}

{
  const ex = "" as unknown as Selector<I18n<string>>;
  ex.eq("");
}

{
  const { title } = "" as unknown as Selector<{
    title: I18n<string>;
  }>;
  title.eq("");
}

{
  const ex = "" as unknown as Selector<I18n<{ title: string }>>;
  ex.title.eq("");
}

{
  const ex = "" as unknown as Selector<I18n<{ title: string }>>;
  ex.title.eq("");
}

{
  const ex = "" as unknown as Selector<
    { type: "foo"; foo: string } | { type: "bar"; bar: number }
  >;
  const out = ex.match("type", {
    foo: (v) => ({ foo: v.foo }), // TODO: ({ foo: v.foo }) gives us never
    bar: (v) => v.bar,
  });
}

// function useVal<Sel extends SelectorC<Source>>(
//   selector: Sel
// ): Sel extends SelectorC<infer S>
//   ? S extends Source
//     ? Val<S>
//     : never
//   : never {
//   throw new Error("TODO");
// }

// {
//   const ex = "" as unknown as Selector<null | {
//     readonly d: "foo";
//     foo: string;
//   }>;
//   ex.d.foo.eq("hei");
// }

// {
//   const ex = "" as unknown as Selector<null | {
//     readonly d: "foo";
//     foo: string;
//   }>;
//   ex.andThen((v) => v.d.eq("foo"));
// }
