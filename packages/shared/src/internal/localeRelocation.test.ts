import {
  Internal,
  initVal,
  type Json,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import { relocateForLocale } from "./localeRelocation";

const { s, c } = initVal();

const AVAILABLE = ["en-US", "nb-NO"];

function relocate(
  valModule: ValModule<Source>,
  path: string,
  locale: string,
  available: readonly string[] = AVAILABLE,
) {
  const schema: SerializedSchema | undefined =
    Internal.getSchema(valModule)?.["executeSerialize"]();
  const source: Json | undefined = Internal.getSource(valModule);
  if (!schema || source === undefined) throw new Error("No module");
  return relocateForLocale(
    path as SourcePath,
    locale,
    schema,
    source,
    available,
  );
}

const translated = c.define(
  "/content/translated.val.ts",
  s.object({
    announcements: s.record(
      s.locale(),
      s.object({ title: s.string(), tags: s.array(s.string()) }),
    ),
    posts: s.array(
      s.object({ locale: s.locale(), title: s.string() }).nullable(),
    ),
    shared: s.string(),
  }),
  {
    announcements: {
      "en-US": { title: "We ship on Fridays", tags: ["a", "b"] },
      "nb-NO": { title: "Vi leverer på fredager", tags: ["a"] },
    },
    posts: [
      { locale: "nb-NO", title: "Innhold som kode" },
      { locale: "en-US", title: "Content as code" },
    ],
    shared: "Same in every language",
  },
);

describe("relocateForLocale", () => {
  test("content in no language stays", () => {
    expect(
      relocate(translated, '/content/translated.val.ts?p="shared"', "nb-NO"),
    ).toEqual({ type: "stay" });
  });

  test("content in the language picked stays", () => {
    expect(
      relocate(
        translated,
        '/content/translated.val.ts?p="announcements"."nb-NO"."title"',
        "nb-NO",
      ),
    ).toEqual({ type: "stay" });
  });

  test("a locale-keyed record moves to the same field under the other key", () => {
    expect(
      relocate(
        translated,
        '/content/translated.val.ts?p="announcements"."en-US"."title"',
        "nb-NO",
      ),
    ).toEqual({
      type: "path",
      path: '/content/translated.val.ts?p="announcements"."nb-NO"."title"',
      reason: "counterpart",
    });
  });

  test("the counterpart keeps as much of the path as still exists", () => {
    // The Norwegian list has one tag, so the second English one has no twin.
    expect(
      relocate(
        translated,
        '/content/translated.val.ts?p="announcements"."en-US"."tags".1',
        "nb-NO",
      ),
    ).toEqual({
      type: "path",
      path: '/content/translated.val.ts?p="announcements"."nb-NO"."tags"',
      reason: "counterpart",
    });
  });

  test("an unwritten translation is still the counterpart", () => {
    const record = c.define(
      "/content/announcements.val.ts",
      s.record(s.locale(), s.object({ title: s.string() })),
      { "en-US": { title: "Hello" }, "nb-NO": null },
    );
    expect(
      relocate(
        record,
        '/content/announcements.val.ts?p="en-US"."title"',
        "nb-NO",
      ),
    ).toEqual({
      type: "path",
      path: '/content/announcements.val.ts?p="nb-NO"',
      reason: "counterpart",
    });
  });

  test("an item with a locale field moves to the list it is in", () => {
    expect(
      relocate(
        translated,
        '/content/translated.val.ts?p="posts".1."title"',
        "nb-NO",
      ),
    ).toEqual({
      type: "path",
      path: '/content/translated.val.ts?p="posts"',
      reason: "parent",
    });
  });

  test("a module that is in another language as a whole goes to the start", () => {
    const page = c.define(
      "/content/home-nb.val.ts",
      s.object({ locale: s.locale(), title: s.string() }),
      { locale: "nb-NO", title: "Hjem" },
    );
    expect(
      relocate(page, '/content/home-nb.val.ts?p="title"', "en-US"),
    ).toEqual({ type: "root" });
  });

  describe("routes that name their language", () => {
    const urlLocale = s
      .enum("nb")
      .nullable()
      .locales({ nb: "nb-NO" }, { null: "en-US" });
    const about = c.define(
      "/src/routes/{-$locale}.about.$slug.val.ts",
      s.router(
        Internal.tanstackRouter,
        { locale: urlLocale, slug: s.string() },
        s.object({ title: s.string() }),
      ),
      {
        "/about/team": { title: "Team" },
        "/nb/about/team": { title: "Laget" },
        "/about/history": { title: "History" },
        "/nb/about/historie": { title: "Historie" },
      },
    );
    const at = (key: string, field = "") =>
      `/src/routes/{-$locale}.about.$slug.val.ts?p=${JSON.stringify(key)}${field}`;

    test("a page whose URL differs only in the language moves to that page", () => {
      expect(relocate(about, at("/about/team", '."title"'), "nb-NO")).toEqual({
        type: "path",
        path: at("/nb/about/team", '."title"'),
        reason: "counterpart",
      });
      // And back: the language a URL WITHOUT the segment is in.
      expect(relocate(about, at("/nb/about/team"), "en-US")).toEqual({
        type: "path",
        path: at("/about/team"),
        reason: "counterpart",
      });
    });

    test("a page with a different slug is not known to be a translation", () => {
      expect(relocate(about, at("/about/history"), "nb-NO")).toEqual({
        type: "root",
      });
    });
  });

  test("a page whose item names its language goes to the start, not the router", () => {
    const blog = c.define(
      "/app/blog/[slug]/page.val.ts",
      s.router(
        Internal.nextAppRouter,
        s.object({ locale: s.locale(), title: s.string() }),
      ),
      { "/blog/hei": { locale: "nb-NO", title: "Hei" } },
    );
    expect(
      relocate(blog, '/app/blog/[slug]/page.val.ts?p="/blog/hei"', "en-US"),
    ).toEqual({ type: "root" });
  });

  test("a project with no languages never moves anyone", () => {
    expect(
      relocate(
        translated,
        '/content/translated.val.ts?p="announcements"."en-US"',
        "nb-NO",
        [],
      ),
    ).toEqual({ type: "stay" });
  });
});
