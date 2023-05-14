/* eslint-disable @typescript-eslint/no-explicit-any */
import { Selector, GenericSelector, Path } from ".";
import { number } from "../schema/number";
import { string } from "../schema/string";
import { Source } from "../source";
import { SourcePath } from "../val";
import { newSelectorProxy, selectorToVal } from "./SelectorProxy";

describe("SelectorProxy", () => {
  test("string eq andThen", () => {
    const sourcePath = "/app/text" as SourcePath;
    const string1 = newSelectorProxy("foo", sourcePath) as Selector<string>;
    expectValOrExpr(string1.eq("foo")).toStrictEqual({
      val: true,
      [Path]: undefined,
    });
    expectValOrExpr(string1.eq("foo").andThen(() => string1)).toStrictEqual({
      val: "foo",
      [Path]: sourcePath,
    });
  });

  test("array filter eq", () => {
    const sourcePath = "/app/texts" as SourcePath;
    const string1 = newSelectorProxy(["foo", "bar"], sourcePath) as Selector<
      string[]
    >;
    expectValOrExpr(
      string1.map((a) => a).filter((a) => a.eq("foo"))
    ).toStrictEqual({
      val: ["foo"],
      [Path]: "/app/texts",
    });
  });

  test("array numbers", () => {
    const sourcePath = "/app/numbers" as SourcePath;
    const numbersVal = newSelectorProxy([1, 2, 3], sourcePath) as Selector<
      string[]
    >;
    expectValOrExpr(numbersVal).toStrictEqual({
      val: [1, 2, 3],
      [Path]: "/app/numbers",
    });
  });

  test("array length", () => {
    const sourcePath = "/app/numbers" as SourcePath;
    const numbersVal = newSelectorProxy([1, 2, 3], sourcePath) as Selector<
      string[]
    >;
    expectValOrExpr(numbersVal.length).toStrictEqual({
      val: 3,
      [Path]: undefined,
    });
  });

  test("array filter match number", () => {
    const sourcePath = "/app/numbers" as SourcePath;
    const numbersVal = newSelectorProxy([1, 2, undefined], sourcePath) as
      | Selector<string[]>
      | Selector<null[]>;
    expectValOrExpr(numbersVal.filter(number())).toStrictEqual({
      val: [1, 2],
      [Path]: "/app/numbers",
    });
  });

  test("array filter match string / undefined / null", () => {
    const sourcePath = "/app/numbers" as SourcePath;
    const numbersVal = newSelectorProxy(
      [1, 2, undefined, null, "test"],
      sourcePath
    ) as Selector<(number | string | null)[]>;
    expectValOrExpr(numbersVal.filter(string().optional())).toStrictEqual({
      val: [null, null, "test"],
      [Path]: "/app/numbers",
    });
  });

  test("object lookup", () => {
    const sourcePath = "/app/blog" as SourcePath;
    const blogsVal = newSelectorProxy(
      { title: "title1" },
      sourcePath
    ) as Selector<{ title: string }>;
    expectValOrExpr(blogsVal).toStrictEqual({
      val: { title: "title1" },
      [Path]: "/app/blog",
    });
  });

  test("object prop", () => {
    const sourcePath = "/app/blog" as SourcePath;
    const blogsVal = newSelectorProxy(
      { title: "title1" },
      sourcePath
    ) as Selector<{ title: string }>;
    expectValOrExpr(blogsVal.title).toStrictEqual({
      val: "title1",
      [Path]: "/app/blog.title",
    });
  });

  test("array object index", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const blogsVal = newSelectorProxy(
      [{ title: "title1" }],
      sourcePath
    ) as Selector<{ title: string }[]>;
    expectValOrExpr(blogsVal[0]).toStrictEqual({
      val: {
        title: "title1",
      },
      [Path]: "/app/blogs.0",
    });
  });

  test("array map object index", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const blogsVal = newSelectorProxy(
      [{ title: "title1" }],
      sourcePath
    ) as Selector<{ title: string }[]>;
    expectValOrExpr(blogsVal.map((v) => v)[0]).toStrictEqual({
      val: {
        title: "title1",
      },
      [Path]: "/app/blogs.0",
    });
  });

  test("map object then index", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const blogsVal = newSelectorProxy(
      [{ title: "title1" }],
      sourcePath
    ) as Selector<{ title: string }[]>;
    expectValOrExpr(blogsVal.map((blog) => blog)).toStrictEqual({
      val: [{ title: "title1" }],
      [Path]: "/app/blogs",
    });
  });

  test("map object then index then prop", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const blogsVal = newSelectorProxy(
      [{ title: "title1" }, { title: "title2" }],
      sourcePath
    ) as Selector<{ title: string }[]>;
    expectValOrExpr(blogsVal.map((blog) => blog)[0].title).toStrictEqual({
      val: "title1",
      [Path]: "/app/blogs.0.title",
    });
  });

  test("map object then prop then index", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const blogsVal = newSelectorProxy(
      [{ title: "title1" }, { title: "title2" }],
      sourcePath
    ) as Selector<{ title: string }[]>;
    expectValOrExpr(blogsVal.map((blog) => blog.title)[0]).toStrictEqual({
      val: "title1",
      [Path]: "/app/blogs.0.title",
    });
  });
});

function expectValOrExpr<T extends Source>(selector: GenericSelector<T>) {
  return expect(selectorToVal(selector));
}
