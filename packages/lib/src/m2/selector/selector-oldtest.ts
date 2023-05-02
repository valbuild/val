/* eslint-disable @typescript-eslint/no-unused-vars */
import { Selector, VAL } from ".";
import { FileSource, I18nSource } from "../Source";

// TODO: create actual test cases - currently testing only type checker

{
  const ex = "" as unknown as Selector<string>;
  const a = ex.andThen((v) => v);
  ex.eq("");
}

{
  const ex = "" as unknown as Selector<undefined>;
  const a = ex.andThen((v) => "");
  ex.eq("");
}

{
  const ex = "" as unknown as Selector<undefined | string>;
  const a = ex.andThen((v) => v.eq(""));
  ex.eq("");
}

{
  const ex = "" as unknown as Selector<{ bar: string } | undefined>;
  const a = ex.andThen((v) => v.bar);
}

{
  const ex = "" as unknown as Selector<{ bar: string }>;
  const { bar } = ex;
  bar.eq("");
}

{
  const ex = "" as unknown as Selector<
    ({ title: string; bar: string } | undefined)[]
  >;
  const out = ex.map((v) => v);
  out[0].andThen((v) => v.title).eq("");
}

{
  const ex = "" as unknown as Selector<
    { title: string; bar: { foo: string } | undefined }[]
  >;
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
  const out = ex.map((v) => v);
  out[0].title;
  out[0].title.eq("");
}

{
  const ex = "" as unknown as Selector<{ title: string; bar: string }[]>;
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
    foo: (v) => ({ foo: v.foo }),
    bar: (v) => v.bar,
  });
}

{
  const ex = "" as unknown as Selector<{
    foo: { type: "foo"; foo: string } | { type: "bar"; bar: number };
  }>;
  const out = ex.foo.match("type", {
    foo: (v) => ({ foo: v.foo }),
    bar: (v) => v.bar,
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
