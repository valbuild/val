import { valueAtPath } from "./sourceAtPath";

describe("valueAtPath", () => {
  const source = { posts: [{ title: "First" }, { title: "Second" }] };

  test("no path is the whole source", () => {
    expect(valueAtPath(source, undefined)).toEqual({
      status: "found",
      value: source,
    });
  });

  test("walks keys and indexes, as create_patch's path does", () => {
    expect(valueAtPath(source, ["posts", "1", "title"])).toEqual({
      status: "found",
      value: "Second",
    });
  });

  test("a path to nothing says where to look instead", () => {
    const missing = valueAtPath(source, ["posts", "7"]);
    expect(missing).toMatchObject({
      status: "invalid",
      message: expect.stringContaining('["posts"]'),
    });
    expect(valueAtPath(source, ["toString"]).status).toBe("invalid");
    expect(valueAtPath(source, "posts").status).toBe("invalid");
  });

  test("only a canonical index reads an item", () => {
    const list = { items: ["a", "b"] };
    for (const index of ["", "1.0", " 1", "01", "-0", "1e0"]) {
      expect(valueAtPath(list, ["items", index]).status).toBe("invalid");
    }
    expect(valueAtPath(list, ["items", "0"])).toEqual({
      status: "found",
      value: "a",
    });
  });
});
