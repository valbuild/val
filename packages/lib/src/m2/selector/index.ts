/* eslint-disable @typescript-eslint/no-unused-vars */

import { I18nDescriptor, I18nSelector } from "./i18n";
import { Selector as ObjectSelector } from "./object";
import { Selector as ArraySelector } from "./array";
import { Selector as PrimitiveSelector } from "./primitive";
import { AssetSelector } from "./asset";

export type SourceObject = { readonly [key: string]: Source };
export type SourcePrimitive = string | number | boolean | null;

declare const brand: unique symbol;

export const FILE_REF_PROP = "ref" as const;
export type FileSource<Ref extends string> = {
  readonly [FILE_REF_PROP]: Ref;
  readonly type: "file"; // TODO: type is a very common property name, does that matter here?
  readonly [brand]: "ValFileSource";
};

export const REMOTE_REF_PROP = "ref" as const; // TODO: same as FILE_REF_PROP so use same prop?
export type RemoteSource<Ref extends string> = {
  readonly [REMOTE_REF_PROP]: Ref;
  readonly type: "remote"; // TODO: type is a very common property name, does that matter here?
  readonly [brand]: "ValRemoteSource";
};

export type Source =
  | SourcePrimitive
  | SourceObject
  | readonly Source[]
  | FileSource<string>;

export class SelectorC<T> {
  constructor(public readonly value: T) {}
}

export type Selector<T> = T extends I18nDescriptor<infer S>
  ? I18nSelector<S>
  : T extends SourceObject
  ? ObjectSelector<T>
  : T extends readonly Source[]
  ? ArraySelector<T>
  : T extends string | boolean | number
  ? PrimitiveSelector<T>
  : never;

// NOTE: the distribution of the conditional type is important here:
// https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
// Without it we get: Type instantiation is excessively deep and possibly infinite.
export type SourceOf<T> = [T] extends [SelectorC<infer S>]
  ? S
  : [T] extends [unknown[]]
  ? SourceOf<T[number]>[]
  : [T] extends [{ [key: string]: unknown }]
  ? {
      [key in keyof T]: SourceOf<T[key]>;
    }
  : T;

export type SelectorOf<U> = Selector<SourceOf<U>>;

// type A = SourceOf<Selector<{ foo: { bar: string } }[]>>;
// type B = SourceOf<Selector<string>>;
// type C = SourceOf<string>;
// type D = SourceOf<{ foo: { bar: string } }[]>;
// //
// type DS1 = Selector<D>;
// type DS2 = Selector<{ foo: { bar: string } }[]>;
// type E = Selector<B>;
// type F = Selector<C>;

// type G = SelectorOf<
//   ObjectSelector<{
//     readonly title: string;
//     readonly bar: string;
//   }>
// >;

{
  const ex = "" as unknown as Selector<string>;
  ex.eq("");
}

// {
//   const ex = "" as unknown as Selector<FileSource<string>>;
//   ex.url.eq("");
// }

{
  const ex = "" as unknown as Selector<
    readonly { readonly title: string; readonly bar: string }[]
  >;
  const out = ex.map((v) => v);
  out[0].title;
  out[0].title.eq("");
}

{
  const ex = "" as unknown as Selector<readonly { readonly title: string }[]>;
  const out = ex.filter((v) => v.title.eq(""));
  out[0].title;
}

{
  const ex = "" as unknown as Selector<
    readonly { readonly title: string; readonly bar: string }[]
  >;
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
  const ex = "" as unknown as Selector<
    readonly { readonly title: string; readonly bar: string }[]
  >;
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
  const ex = "" as unknown as Selector<
    readonly { readonly title: string; readonly bar: string }[]
  >;
  const out = ex.map((v) => [v.title, v.title]);
  out[0][0].eq("");
}

{
  const ex = "" as unknown as Selector<
    readonly { readonly title: string; readonly bar: string }[]
  >;

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

// {
//   const ex = "" as unknown as Selector<
//     readonly { readonly title: string; readonly bar: string }[]
//   >;
//   const out = ex.map((v) => ({ title: "" }));
// }

// {
//   const ex = "" as unknown as Selector<
//     readonly { readonly title: string; readonly bar: string }[]
//   >;
//   const out = ex.map((v) => ({ title1: v.title }));
// }

// {
//   const ex = "" as unknown as Selector<I18nDescriptor<string>>;
//   ex.eq("");
// }

// {
//   const ex = "" as unknown as Selector<{
//     readonly title: I18nDescriptor<string>;
//   }>;
//   ex.title.eq("");
// }

// {
//   const ex = "" as unknown as Selector<
//     I18nDescriptor<{ readonly title: string }>
//   >;
//   ex.title.eq("");
// }

// {
//   const ex = "" as unknown as Selector<
//     { readonly d: "foo"; foo: string } | { readonly d: "bar"; bar: number }
//   >;
//   ex.d.eq("foo");
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
