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
    expect(
      checkExternalSetup({ [POSTS]: postsSchema }, registry()).errors,
    ).toEqual([]);
  });

  test("a project with no external records is told nothing", () => {
    // Never ask someone to configure a feature they do not use.
    const plain = s.record(s.string())["executeSerialize"]();
    expect(checkExternalSetup({ [POSTS]: plain }, undefined).errors).toEqual(
      [],
    );
  });

  test("an .external() module with no registry at all is reported", () => {
    // The case worth catching: an unbound external record reads as EMPTY, and
    // empty is a legitimate state for a store, so nothing downstream can tell.
    const { errors } = checkExternalSetup({ [POSTS]: postsSchema }, undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe(POSTS);
    expect(errors[0].message).toContain("no adapter is registered for 'posts'");
  });

  test("an .external() module missing from a registry that exists is reported", () => {
    const other = s.record(s.string()).external("skus")["executeSerialize"]();
    const { errors } = checkExternalSetup(
      { [POSTS]: postsSchema, [AUTHORS]: other },
      registry(),
    );
    expect(errors.map((e) => e.path)).toEqual([AUTHORS]);
    expect(errors[0].message).toContain("no adapter is registered for 'skus'");
  });

  test("a binding no module asks for is reported — usually half a rename", () => {
    const { errors } = checkExternalSetup({}, registry());
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
    const { errors } = checkExternalSetup(
      { [AUTHORS]: postsSchema },
      registry(),
    );
    expect(errors.map((e) => e.message).join("\n")).toContain(
      `'posts' is bound to ${POSTS}`,
    );
  });
});

describe("media needs a place to put the bytes", () => {
  const gallerySchema = s
    .images({ accept: "image/*", directory: "/public/val/g" })
    .external("gallery")
    ["executeSerialize"]();

  function galleryRegistry(
    files: "bytes" | "presigned" | "none",
  ): ExternalRecords {
    const galleryVal = c.define(
      "/content/gallery.val.ts",
      s
        .images({ accept: "image/*", directory: "/public/val/g" })
        .external("gallery"),
      c.external(),
    );
    const { entry, modules } = defineExternal();
    return modules({
      gallery: entry(galleryVal, {
        keys: async () => ok({ keys: [], cursor: null }),
        get: async () => ok({}),
        put: async () => ok(undefined),
        delete: async () => ok(undefined),
        ...(files === "bytes"
          ? {
              files: {
                type: "bytes" as const,
                put: async () => ok({}),
                get: async () => ok(null),
              },
            }
          : files === "presigned"
            ? {
                files: {
                  type: "presigned" as const,
                  signUpload: async () => ok({ url: "https://s3/put" }),
                  url: async () => ok({ url: "https://cdn/x.png" }),
                },
              }
            : {}),
      }),
    });
  }

  const GALLERY = "/content/gallery.val.ts" as ModuleFilePath;

  test("a gallery whose adapter has no files at all is reported", () => {
    // A gallery has no image schema INSIDE it — the item is width/height/mimeType
    // metadata and the file is named by the record's key — so this cannot be a
    // check on the adapter type. It has to be a check on the schema.
    const { errors } = checkExternalSetup(
      { [GALLERY]: gallerySchema },
      galleryRegistry("none"),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("has no 'files'");
    // Both ways out are named, because which one is right depends on where the
    // developer deploys and Val cannot pick for them here.
    expect(errors[0].message).toContain('type: "bytes"');
    expect(errors[0].message).toContain('type: "presigned"');
  });

  test.each(["bytes", "presigned"] as const)(
    "and is fine once it has files: %s",
    (type) => {
      expect(
        checkExternalSetup({ [GALLERY]: gallerySchema }, galleryRegistry(type))
          .errors,
      ).toEqual([]);
    },
  );

  test("a half-built files is not something this check has to catch", () => {
    // The union already refuses `{ type: "bytes", put }` with no `get`, so the
    // startup check only has to ask whether `files` is there at all. This test
    // exists to pin that division: if the union is ever loosened into optional
    // siblings, the check needs the missing-half arm back.
    const { errors } = checkExternalSetup(
      { [GALLERY]: gallerySchema },
      galleryRegistry("bytes"),
    );
    expect(errors).toEqual([]);
  });

  test("a record with no media needs none of it", () => {
    expect(
      checkExternalSetup({ [POSTS]: postsSchema }, registry()).errors,
    ).toEqual([]);
  });
});

describe("routing bytes through a serverless function is warned about, not refused", () => {
  const gallerySchema = s
    .images({ accept: "image/*", directory: "/public/val/g" })
    .external("gallery")
    ["executeSerialize"]();
  const GALLERY = "/content/gallery.val.ts" as ModuleFilePath;

  function galleryRegistry(type: "bytes" | "presigned"): ExternalRecords {
    const galleryVal = c.define(
      "/content/gallery.val.ts",
      s
        .images({ accept: "image/*", directory: "/public/val/g" })
        .external("gallery"),
      c.external(),
    );
    const { entry, modules } = defineExternal();
    return modules({
      gallery: entry(galleryVal, {
        keys: async () => ok({ keys: [], cursor: null }),
        get: async () => ok({}),
        put: async () => ok(undefined),
        delete: async () => ok(undefined),
        files:
          type === "bytes"
            ? {
                type: "bytes",
                put: async () => ok({}),
                get: async () => ok(null),
              }
            : {
                type: "presigned",
                signUpload: async () => ok({ url: "https://s3/put" }),
                url: async () => ok({ url: "https://cdn/x.png" }),
              },
      }),
    });
  }

  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  test("on Vercel, files: bytes warns and names the platform and the limit", () => {
    process.env.VERCEL = "1";
    const { errors, warnings } = checkExternalSetup(
      { [GALLERY]: gallerySchema },
      galleryRegistry("bytes"),
    );
    // A warning, never an error: a record that only ever holds small files is
    // not misconfigured, and Val cannot know that it does not.
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe(GALLERY);
    expect(warnings[0].message).toContain("Vercel");
    expect(warnings[0].message).toContain("4.5 MB");
    expect(warnings[0].message).toContain('type: "presigned"');
  });

  test("on Vercel, files: presigned is silent — it is the fix", () => {
    process.env.VERCEL = "1";
    const { errors, warnings } = checkExternalSetup(
      { [GALLERY]: gallerySchema },
      galleryRegistry("presigned"),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("off a capped platform, files: bytes is silent", () => {
    // The whole point: someone on a VPS, in Docker or on their own machine
    // should never be told that presigned uploads exist.
    delete process.env.VERCEL;
    delete process.env.NETLIFY;
    delete process.env.CF_PAGES;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const { errors, warnings } = checkExternalSetup(
      { [GALLERY]: gallerySchema },
      galleryRegistry("bytes"),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("a record with no media is never warned about, wherever it runs", () => {
    process.env.VERCEL = "1";
    expect(
      checkExternalSetup({ [POSTS]: postsSchema }, registry()).warnings,
    ).toEqual([]);
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
