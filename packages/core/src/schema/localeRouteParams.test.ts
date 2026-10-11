import { initVal } from "../initVal";
import { Internal } from "..";
import { nextAppRouter, tanstackRouter } from "../router";
import { ModuleFilePath } from "../val";
import { untypedLocaleRouteParamErrors } from "./localeRouteParams";
import type { SerializedSchema } from ".";
import type { ValModule } from "../module";
import type { Source } from "../source";

const { s, c } = initVal();

const page = s.object({ title: s.string() });
const urlLocale = s
  .enum("nb")
  .nullable()
  .locales({ nb: "nb-NO" }, { null: "en-US" });

function project(available: string[] | null, modules: ValModule<Source>[]) {
  const settings = c.define(
    "/settings.val.ts",
    s.settings(),
    available === null ? {} : { locales: { available } },
  );
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of [settings, ...modules]) {
    const path = Internal.getValPath(valModule) as unknown as ModuleFilePath;
    const schema = Internal.getSchema(valModule);
    const source = Internal.getSource(valModule);
    if (!schema || source === undefined) {
      throw new Error(`no schema or source for ${path}`);
    }
    schemas[path] = schema["executeSerialize"]();
    sources[path] = source;
  }
  return untypedLocaleRouteParamErrors(schemas, sources);
}

const forgotten = c.define(
  "/src/routes/{-$locale}/blog.$slug.val.ts",
  s.router(tanstackRouter, { slug: s.string() }, page),
  { "/blog/hello": { title: "Hello" } },
);

describe("a route's language segment with nothing to describe it", () => {
  test("is reported on the module, saying what to write", () => {
    const errors = project(["en-US", "nb-NO"], [forgotten]);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("/src/routes/{-$locale}/blog.$slug.val.ts");
    expect(errors[0].message).toContain("'locale' segment ([[locale]])");
    expect(errors[0].message).toContain(
      "s.router(router, { locale: urlLocale, … }, item)",
    );
  });

  test("is reported for a router with no parameters at all, and for Next's [lang]", () => {
    const plain = c.define(
      "/src/routes/{-$locale}/about.val.ts",
      s.router(tanstackRouter, page),
      { "/about": { title: "About" } },
    );
    const next = c.define(
      "/app/[lang]/news/page.val.ts",
      s.router(nextAppRouter, page),
      { "/nb/news": { title: "Nyheter" } },
    );
    expect(project(["en-US"], [plain, next]).map((each) => each.path)).toEqual([
      "/app/[lang]/news/page.val.ts",
      "/src/routes/{-$locale}/about.val.ts",
    ]);
  });

  test("is not reported once the parameter has a locale schema", () => {
    const described = c.define(
      "/src/routes/{-$locale}/blog.$slug.val.ts",
      s.router(tanstackRouter, { locale: urlLocale, slug: s.string() }, page),
      { "/blog/hello": { title: "Hello" } },
    );
    expect(project(["en-US", "nb-NO"], [described])).toEqual([]);
  });

  test("any schema is an answer: a $lang that is not a language says so", () => {
    const code = c.define(
      "/src/routes/docs.$lang.val.ts",
      s.router(tanstackRouter, { lang: s.enum("typescript", "python") }, page),
      { "/docs/typescript": { title: "TypeScript" } },
    );
    expect(project(["en-US"], [code])).toEqual([]);
  });

  test("a project that has declared no languages is not translated, so nothing is reported", () => {
    expect(project(null, [forgotten])).toEqual([]);
    expect(project([], [forgotten])).toEqual([]);
  });

  test("other parameter names are left alone", () => {
    const country = c.define(
      "/src/routes/$country.shops.val.ts",
      s.router(tanstackRouter, page),
      { "/no/shops": { title: "Butikker" } },
    );
    expect(project(["en-US"], [country])).toEqual([]);
  });
});
