/* eslint-disable @typescript-eslint/no-unused-vars */
import { Selector, VAL_OR_EXPR } from ".";
import { FileSource, I18nSource } from "../Source";

// TODO: create actual test cases - currently testing only type checker

{
  const ex = "" as unknown as Selector<FileSource<string>>;
  ex.url.eq("");
}

{
  const ex = "" as unknown as Selector<I18nSource<"en_US", string>>;
  ex.eq("");
}

{
  const { title } = "" as unknown as Selector<{
    title: I18nSource<"en_US", string>;
  }>;
  title.eq("");
}

{
  const ex = "" as unknown as Selector<I18nSource<"en_US", { title: string }>>;
  ex.title.eq("");
}

{
  const ex = "" as unknown as Selector<I18nSource<"en_US", { title: string }>>;
  ex.title.eq("");
}

{
  const ex = "" as unknown as Selector<{
    foo: I18nSource<"en_US", { title: string }>;
  }>;
  ex.foo.title.eq("");
}

{
  const ex = "" as unknown as Selector<
    { type: "foo"; foo: string } | { type: "bar"; bar: number }
  >;
  const out = ex.match("type", {
    foo: (v) => ({ t: v.type, foo: v.foo }),
    bar: (v) => ({ t: v.type, bar: v.bar }),
  });
  // .match("t", {
  //   foo: (v) => v.foo,
  //   bar: (v) => v.bar,
  // });
}

{
  const ex = "" as unknown as Selector<{
    foo: (
      | { type: "foo"; foo: { type: "subfoo1" } | { type: "subfoo2" } }
      | { type: "bar"; bar: number }
    )[];
  }>;
  const out = ex.foo[0].match("type", {
    foo: (v) => ({
      foo: v.foo.match("type", {
        subfoo1: (v) => v.type,
        subfoo2: (v) => v,
      }),
    }),
    bar: (v) => ({ blah: v.bar }),
  });
}

{
  const ex = "" as unknown as Selector<
    ({ type: "foo"; foo: string } | { type: "bar"; bar: number })[]
  >;
  const out = ex.map((v) =>
    v.match("type", {
      foo: (v) => ({ foo: v.foo }),
      bar: (v) => v.bar,
    })
  );
}
