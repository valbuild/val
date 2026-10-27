import { initVal } from "@valbuild/core";
import { attrs } from "./attrs";
import { stegaEncode, type ResolvedVal } from "./stegaEncode";

const { s, c } = initVal();

const authorsVal = c.define(
  "/content/authors.val.ts",
  s.record(s.object({ name: s.string() })),
  { ingrid: { name: "Ingrid" }, tomas: { name: "Tomas" } },
);
const postsVal = c.define(
  "/content/posts.val.ts",
  s.record(s.object({ title: s.string(), author: s.keyOf(authorsVal) })),
  { "first-post": { title: "First", author: "ingrid" } },
);

describe("attrs", () => {
  test("is every path inside what it is given", () => {
    const posts: ResolvedVal<typeof postsVal> = stegaEncode(postsVal, {});
    const paths = attrs(posts["first-post"])["data-val-path"]?.split(",");
    expect(paths).toContain('/content/posts.val.ts?p="first-post"');
    expect(paths).toContain('/content/posts.val.ts?p="first-post"."title"');
  });

  /*
   * A key is never stega encoded -- it is looked up with, and an invisible
   * tag would make it miss -- so nothing on the page says which field it came
   * from unless the element is told.
   */
  test("is one field, for a value that carries no path of its own", () => {
    const posts: ResolvedVal<typeof postsVal> = stegaEncode(postsVal, {});
    const post = posts["first-post"];
    expect(post.author).toBe("ingrid");
    expect(attrs(post, "author")).toEqual({
      "data-val-path": '/content/posts.val.ts?p="first-post"."author"',
    });
  });

  test("is nothing for a value Val did not read", () => {
    expect(attrs({ author: "ingrid" }, "author")).toEqual({});
  });
});
