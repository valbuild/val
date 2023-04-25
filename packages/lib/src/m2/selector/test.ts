// declare const brand: unique symbol;
// export type SourceObject = { [key: string]: string };
// type PrimitiveSelector<T extends string> = {
//   sel: T;
//   [brand]: "PrimitiveSelector";
// };

import { Selector } from ".";

// export type ObjectSelector<T extends SourceObject> = {
//   readonly [key in keyof T]: PrimitiveSelector<T[key]>;
// };

// {
//   const ex = "" as unknown as ObjectSelector<{ d: "foo" } | { d: "bar" }>;
//   ex.d.eq("foo");
// }

declare const brand: unique symbol;
export type SourceObject = { [key: string]: string };
type PrimitiveSelector<T extends string> = {
  sel: T;
  [brand]: "PrimitiveSelector";
};
export type ObjectSelector<T extends SourceObject> = {
  readonly [key in keyof T]: PrimitiveSelector<T[key]>;
} & {
  match: <
    K extends keyof T,
    R,
    Cases extends { [V in T as V[K]]: (v: V) => R }
  >(
    key: K,
    cases: Cases
  ) => Cases[T[K]] extends (v: any) => infer R ? R : never;
};

{
  const ex = "" as unknown as ObjectSelector<
    { d: "foo"; foo: "" } | { d: "bar"; bar: "" }
  >;
  const a = ex.match("d", {
    foo(v) {
      return v.foo.length;
    },
    bar(v) {
      return v.bar;
    },
  });
}

{
  const ex = "" as unknown as Selector<string | undefined>;
  ex;
}
