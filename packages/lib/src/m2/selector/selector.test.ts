/* eslint-disable @typescript-eslint/no-unused-vars */
import { VAL } from ".";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { array } from "../schema/array";
import { createSelector } from "./create";
import { SourcePath } from "../val";

describe("selector", () => {
  test("array with string", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const source = ["title1"];
    const schema = array(string());

    expect(createSelector(sourcePath, schema, source)[0][VAL]()).toStrictEqual({
      val: "title1",
      valPath: "/app/blogs.0",
    });
  });

  test("array with string", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const source = { title: "title1" };
    const schema = object({ title: string() });

    expect(
      createSelector(sourcePath, schema, source).title[VAL]()
    ).toStrictEqual({ val: "title1", valPath: "/app/blogs.title" });
  });

  test("array with object", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const source = [{ title: "title1" }];
    const schema = array(object({ title: string() }));
    expect(
      createSelector(sourcePath, schema, source)
        .map((i) => i.title)
        [VAL]()[0]
    ).toStrictEqual({ val: "title1", valPath: "/app/blogs.0.title" });
  });

  test("array indexed", () => {
    const sourcePath = "/app/blogs" as SourcePath;
    const source = [{ title: "title1" }];
    const schema = array(object({ title: string() }));
    expect(
      createSelector(sourcePath, schema, source)
        .map((i) => i.title)[0]
        [VAL]()
    ).toStrictEqual({
      val: "title1",
      valPath: "/app/blogs.0.title",
    });
  });
});
