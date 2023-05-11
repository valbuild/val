/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Selector,
  GenericSelector,
  SelectorOf,
  SelectorSource,
  SourceOrExpr,
  SourceOf,
} from "..";
import { Selector as BooleanSelector } from "../boolean";
import { Schema } from "../../schema";
import { string } from "../../schema/string";
import { FileSource, I18nSource, Source, SourceObject } from "../../Source";
import { array } from "../../schema/array";
import { object } from "../../schema/object";

// TODO: create actual test cases - currently testing only type checker

{
  const ex = "" as unknown as Selector<FileSource<string>>;
  ex.url.eq("");
}

{
  const ex = "" as unknown as Selector<I18nSource<["en_US", "no_NB"], string>>;
  ex.eq("");
  const a = ex.all();
  a.en_US.eq("");
}

{
  const { title } = "" as unknown as Selector<{
    title: I18nSource<["en_US"], string>;
  }>;
  title.eq("");
}

{
  const ex = "" as unknown as Selector<
    SourceOf<I18nSource<["en_US"], { title: string }>>
  >;
  ex.title.eq("");
}

{
  const ex = "" as unknown as Selector<
    I18nSource<["en_US"], { title: string }>
  >;
  ex.title.eq("");
}

{
  const ex = "" as unknown as Selector<{
    foo: I18nSource<["en_US"], { title: string }>;
  }>;
  ex.foo.title.eq("");
}

{
  const ex = "" as unknown as Selector<(string | number)[]>;
  const out = ex.assert(array(string()), () => {
    throw new Error("TODO");
  });

  const r = {} as Record<string, number>;
  r[""];
}

// {
//   const ex = "" as unknown as Selector<(string | number)[]>;
//   const out = ex.filter(string());
// }
// {
//   const ex = "" as unknown as Selector<{
//     foo: { bar: string } | undefined;
//     zoo: string;
//   }>;
//   const out1 = ex.foo.bar;
//   const out2 = ex.zoo;
// }

// type M<T extends SourceObject> = MatchRes<>

// function match<
//   S extends SelectorC<SourceObject>,
//   Tag extends keyof SourceOfSelector<S>,
//   Cases extends {
//     [Value in SourceOfSelector<S> as Value[Tag] & string]: (
//       v: Selector<Value>
//     ) => SelectorSource;
//   }
// >(
//   target: S,
//   key: Tag,
//   cases: Cases
// ): {
//   throw new Error("unimplemented");
// }

{
  const ex = "" as unknown as
    | Selector<{ type: "foo"; foo: string }>
    | Selector<{ type: "bar"; bar: number }>;

  const out = ex.fold("type")({
    bar: (v) => v.bar,
    foo: (v) => v.foo as Selector<string | number>,
  });
}

// {
//   const ex = "" as unknown as Selector<
//     { type: "foo"; foo: string } | { type: "bar"; bar: number }
//   >;
//   const out = ex
//     .fold("type")({
//       foo: (v) =>
//         ({ t: v.type, foo: v.foo }),
//       bar: (v) =>
//         ({ t: v.type, foo: '' })
//     })
//     .fold("t")({
//     foo: (v) => 1,
//     bar: (v) => 2,
//   });
//   // TODO:
//   // .match("t", {
//   //   foo: (v) => v.foo,
//   //   bar: (v) => v.bar,
//   // });
// }

// {
//   const ex = "" as unknown as Selector<
//     { type: "foo"; foo: string } | { type: "bar"; bar: number }
//   >;
//   const out: Selector<
//     | {
//         t: "foo";
//         foo: string;
//       }
//     | {
//         t: "bar";
//         bar: number;
//       }
//   > = ex.fold("type", {
//     foo: (v) => ({ t: v.type, foo: v.foo }),
//     bar: (v) => ({ t: v.type, bar: v.bar }),
//   });
//   const out2 = out.fold("t", {
//     foo: (v) => ({ z: "a", foo: v.foo } as const),
//     bar: (v) => ({ z: "b", bar: v.bar } as const),
//   });
//   const out3 = out2.match("z", {
//     a: (v) => v.foo,
//     b: (v) => v.bar,
//   });
// }

// {
//   const ex = "" as unknown as Selector<
//     { type: "foo"; foo: string } | { type: "bar"; bar: number }
//   >;
//   const out = ex
//     .fold("type", {
//       foo: (v) => ({ t: "test1", foo: v.foo } as const),
//       bar: (v) => ({ t: "test2", bar: v.bar } as const),
//     })
//     .match("t", {
//       test1: (v) => v.foo,
//       test2: (v) => v.bar,
//     });
// }

// {
//   const ex = "" as unknown as Selector<{
//     foo: (
//       | { type: "foo"; foo: { type: "subfoo1" } | { type: "subfoo2" } }
//       | { type: "bar"; bar: number }
//     )[];
//   }>;
//   const out = ex.foo[0].fold("type", {
//     foo: (v) => ({
//       foo: v.foo.match("type", {
//         subfoo1: (v) => v.type,
//         subfoo2: (v) => v,
//       }),
//     }),
//     bar: (v) => ({ blah: v.bar }),
//   });
// }

// {
//   const ex = "" as unknown as Selector<
//     ({ type: "foo"; foo: string } | { type: "f"; bar: number })[]
//   >;

//   const a = ex.filterMatch({
//     type: "foo",
//   });
// }

// {
//   const ex = "" as unknown as Selector<
//     (
//       | { type: "foo"; foo: string }
//       // | { type: "f"; bar: number }
//       | { type2: "f"; bar: number }
//     )[]
//   >;

//   const a: never = ex.filterMatch({ type: "foo" }); // should be never only type in one
// }

// {
//   const ex = "" as unknown as Selector<
//     ({ type: "foo"; foo: string } | { type: "bar"; bar: number })[]
//   >;
//   const out = ex.map((v) => {
//     const test = v.fold<
//       "type",
//       {
//         foo: (v: Selector<{ type: "foo"; foo: string }>) => {
//           foo: Selector<string>;
//         };
//         bar: (v: Selector<{ type: "bar"; bar: number }>) => Selector<number>;
//       }
//     >("type", {
//       foo: (v) => ({ foo: v.foo }),
//       bar: (v) => v.bar,
//     });
//     return test;
//   });
// }

{
  const ex = "" as unknown as Selector<string[]>;
  const out = ex.map(
    (v) => null as unknown as Selector<number> | Selector<{ foo: number }>
  );
}
