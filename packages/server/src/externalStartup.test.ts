import {
  initVal,
  type ModuleFilePath,
  type SerializedSchema,
} from "@valbuild/core";
import {
  checkExternalSetup,
  findNestedExternalRecords,
  rootExternalLabel,
} from "./externalStartup";
import { defineExternal, ok, type ExternalRecords } from "./externalRecords";

const { s, c } = initVal();

const POSTS = "/content/posts.val.ts" as ModuleFilePath;
const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;

const postsVal = c.define(
  "/content/posts.val.ts",
  s.record(s.object({ title: s.string() })).external("posts"),
  c.external(),
);

const postsSchema = s
  .record(s.object({ title: s.string() }))
  .external("posts")
  ["executeSerialize"]();

function registry(): ExternalRecords {
  const { entry, modules } = defineExternal();
  return modules({
    posts: entry(postsVal, {
      keys: async () => ok({ keys: [], cursor: null }),
      get: async () => ok({}),
      put: async () => ok(undefined),
      delete: async () => ok(undefined),
    }),
  });
}

describe("checkExternalSetup", () => {
  test("a bound module is fine", () => {
    expect(checkExternalSetup({ [POSTS]: postsSchema }, registry())).toEqual(
      [],
    );
  });

  test("a project with no external records is told nothing", () => {
    // Never ask someone to configure a feature they do not use.
    const plain = s.record(s.string())["executeSerialize"]();
    expect(checkExternalSetup({ [POSTS]: plain }, undefined)).toEqual([]);
  });

  test("an .external() module with no registry at all is reported", () => {
    // The case worth catching: an unbound external record reads as EMPTY, and
    // empty is a legitimate state for a store, so nothing downstream can tell.
    const errors = checkExternalSetup({ [POSTS]: postsSchema }, undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe(POSTS);
    expect(errors[0].message).toContain("no adapter is registered for 'posts'");
  });

  test("an .external() module missing from a registry that exists is reported", () => {
    const other = s.record(s.string()).external("skus")["executeSerialize"]();
    const errors = checkExternalSetup(
      { [POSTS]: postsSchema, [AUTHORS]: other },
      registry(),
    );
    expect(errors.map((e) => e.path)).toEqual([AUTHORS]);
    expect(errors[0].message).toContain("no adapter is registered for 'skus'");
  });

  test("a binding no module asks for is reported — usually half a rename", () => {
    const errors = checkExternalSetup({}, registry());
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(
      'no module declares .external("posts")',
    );
    // Reported against the module the binding names, which is where the
    // developer will look.
    expect(errors[0].path).toBe(POSTS);
  });

  test("a label bound to a DIFFERENT module is reported", () => {
    // A type error at the modules({ ... }) call, so this is for the caller
    // TypeScript did not see: a JavaScript project, or two files never checked
    // together.
    const errors = checkExternalSetup({ [AUTHORS]: postsSchema }, registry());
    expect(errors.map((e) => e.message).join("\n")).toContain(
      `'posts' is bound to ${POSTS}`,
    );
  });
});

describe("findNestedExternalRecords", () => {
  test("a root external record is not nested", () => {
    expect(findNestedExternalRecords(postsSchema)).toEqual([]);
    expect(rootExternalLabel(postsSchema)).toBe("posts");
  });

  test("one inside an object is found, by path", () => {
    // Unsupported for a sharper reason than nested .jsonValues(): a binding
    // names a MODULE, so there is nowhere to register a second adapter for the
    // same module. A nested one reads as an empty record forever.
    const schema = s
      .object({
        title: s.string(),
        posts: s.record(s.string()).external("posts"),
      })
      ["executeSerialize"]();
    expect(findNestedExternalRecords(schema)).toEqual([["posts"]]);
  });

  test("one inside an array of objects is found", () => {
    const schema = s
      .array(s.object({ posts: s.record(s.string()).external("posts") }))
      ["executeSerialize"]();
    expect(findNestedExternalRecords(schema)).toEqual([["*", "posts"]]);
  });

  test("a plain nested record is not reported", () => {
    const schema = s
      .object({
        posts: s.record(s.string()),
      })
      ["executeSerialize"]();
    expect(findNestedExternalRecords(schema)).toEqual([]);
  });

  test("rootExternalLabel says nothing about a non-record", () => {
    const schema: SerializedSchema = s
      .object({ a: s.string() })
      ["executeSerialize"]();
    expect(rootExternalLabel(schema)).toBeUndefined();
  });
});
