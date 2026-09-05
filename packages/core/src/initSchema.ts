// import type { F } from "ts-toolbelt";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { boolean } from "./schema/boolean";
import { union } from "./schema/union";
import { richtext } from "./schema/richtext";
import { image } from "./schema/image";
import { literal } from "./schema/literal";
import { keyOf } from "./schema/keyOf";
import { record } from "./schema/record";
import { file } from "./schema/file";
import { files } from "./schema/files";
import { date } from "./schema/date";
import { datetime } from "./schema/datetime";
import { code } from "./schema/code";
import { color } from "./schema/color";
import { locale } from "./schema/locale";
import { route } from "./schema/route";
import { router } from "./schema/router";
import { images } from "./schema/images";
import { settings } from "./schema/settings";
// import { i18n, I18n } from "./schema/future/i18n";
// import { oneOf } from "./schema/future/oneOf";

export type InitSchema = {
  /**
   * Define a string.
   *
   * @example
   * const schema = s.string();
   * export default c.define("/example.val.ts", schema, "test");
   *
   */
  readonly string: typeof string;
  /**
   * Define a boolean.
   *
   * @example
   * const schema = s.boolean();
   * export default c.define("/example.val.ts", schema, true);
   *
   */
  readonly boolean: typeof boolean;
  /**
   * Define an array.
   *
   * @example
   * const schema = s.array(s.string());
   * export default c.define("/example.val.ts", schema, ["test", "test2"]);
   *
   */
  readonly array: typeof array;
  /**
   * Define an object.
   *
   * @example
   * const schema = s.object({
   *  text: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, { text: "test" });
   */
  readonly object: typeof object;
  /**
   * Define a number.
   *
   * @example
   * const schema = s.number();
   * export default c.define("/example.val.ts", schema, 1);
   *
   */
  readonly number: typeof number;
  /**
   * Define a union.
   *
   * @example // union of string literals
   * const schema = s.union(s.literal("test"), s.literal("test2"));
   * export default c.define("/example.val.ts", schema, "test");
   *
   * @example // union of string literals
   * const schema = s.union("type", s.object({
   *   type: s.literal("test"),
   *   value: s.string()
   * }), s.object({
   *   type: s.literal("test2"),
   *   value: s.string()
   * }));
   * export default c.define("/example.val.ts", schema, {
   *   type: "test",
   *   value: "test"
   * });
   *
   */
  readonly union: typeof union;
  /**
   * Define a rich text.
   *
   * @example
   * const schema = s.richtext();
   * export default c.define("/example.val.ts", schema, [
   *   { tag: "h1", children: ["Title 1"] },
   * ]);
   */
  readonly richtext: typeof richtext;
  /**
   * Define an image.
   *
   * An image is an object with a `path`. `width`, `height` and `mimeType` are
   * read from the file — the VS Code extension fills them in as you type the
   * path, and `npx val validate --fix` adds any that are missing. `alt` and
   * `hotspot` are yours to set.
   *
   * @example
   * const schema = s.image();
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.png",
   *   width: 100,
   *   height: 100,
   *   mimeType: "image/png",
   *   alt: "An example",
   *   hotspot: { x: 0.5, y: 0.5 },
   * });
   *
   * @example
   * // Backed by a gallery: width, height and mimeType live there.
   * const schema = s.image(galleryVal);
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.png",
   * });
   *
   */
  readonly image: typeof image;
  /**
   * Define a literal.
   *
   * @example
   * const schema = s.literal("test");
   * export default c.define("/example.val.ts", schema, "test");
   *
   */
  readonly literal: typeof literal;
  /**
   * Define a key of.
   *
   * @example
   * import otherVal from "./other.val"; // this must be a record
   * const schema = s.keyOf(otherVal);
   * export default c.define("/example.val.ts", schema, "test");
   *
   */
  readonly keyOf: typeof keyOf;
  /**
   * Define a record.
   *
   * @example
   * const schema = s.record(s.string());
   * export default c.define("/example.val.ts", schema, { "test": "test" });
   *
   */
  readonly record: typeof record;
  /**
   * Define a file.
   *
   * A file is an object with a `path`. `mimeType` comes from the extension —
   * `npx val validate --fix` adds it.
   *
   * @example
   * const schema = s.file();
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.pdf",
   *   mimeType: "application/pdf",
   * });
   *
   */
  readonly file: typeof file;
  /**
   * Define a date.
   *
   * @example
   * const schema = s.date();
   * export default c.define("/example.val.ts", schema, "2025-01-01");
   *
   */
  readonly date: typeof date;
  /**
   * Define a date and time.
   *
   * Stored as an ISO 8601 datetime string (UTC).
   *
   * @example
   * const schema = s.datetime();
   * export default c.define("/example.val.ts", schema, "2025-01-01T12:00:00.000Z");
   *
   */
  readonly datetime: typeof datetime;
  /**
   * Define a color.
   *
   * Stored as a CSS color string, so it can be used directly in `style`
   * attributes or set as a CSS custom property.
   *
   * The notation is decided by the `format` option, which defaults to `"hsl"`.
   * Set `alpha: true` to allow transparency.
   *
   * @example
   * const schema = s.color();
   * export default c.define("/example.val.ts", schema, "hsl(217.22 91.22% 59.8%)");
   *
   * @example
   * const schema = s.color({ format: "hex" });
   * export default c.define("/example.val.ts", schema, "#3b82f6");
   *
   */
  readonly color: typeof color;
  /**
   * Define a string edited in a code editor.
   *
   * Pass a `language` to syntax highlight it; leave it out for a plain
   * monospaced editor. The value is a plain string, and — unlike `s.string()` —
   * it is never stega encoded, so the code reaches your app as it was written.
   *
   * @example
   * const schema = s.code({ language: "typescript" });
   * export default c.define("/example.val.ts", schema, "const a = 1;");
   *
   * @example
   * const schema = s.code();
   * export default c.define("/example.val.ts", schema, "no highlighting here");
   *
   */
  readonly code: typeof code;
  /**
   * Define a string that references a route path in your application.
   *
   * To create router pages you can use the s.router() function.
   *
   * @example
   * ```typescript
   * const schema = s.route(); // use .include() and .exclude() to constrain the route paths
   * export default c.define("/example.val.ts", schema, "/a-page-slug");
   * ```
   */
  /**
   * Define one of the project's languages.
   *
   * The languages themselves are declared in the settings module, under
   * `locales.available` — this says only that a value is one of them, which is
   * checked against that list.
   *
   * @example // a field: everything under this object is in this language
   * const schema = s.object({ locale: s.locale(), title: s.string() });
   *
   * @example // a key: one entry per language
   * const schema = s.record(s.locale(), s.object({ title: s.string() }));
   *
   * @example // stored as a short URL segment rather than the tag
   * const schema = s.locale().aliases({ "en-US": "en", "nb-NO": "no" });
   */
  readonly locale: typeof locale;
  readonly route: typeof route;
  /**
   * Create a page router.
   * Each key is the path of the page.
   *
   * The router will be used to validate the paths of the pages.
   *
   * If you need to link to these pages you can use the s.route() to reference page paths.
   *
   * @example Next.js App Router
   * ```typescript
   * import { s, c, nextAppRouter } from "../val.config";
   * const schema = s.object({
   *   title: s.string(),
   * });
   * export default c.define("/app/[slug]/page.val.ts", s.router(nextAppRouter, schema), {
   *   "/a-page-slug": { title: "First Page" },
   *   "/another-page-slug": { title: "Second Page" },
   * });
   * ```
   *
   * @param router - The router configuration (e.g., nextAppRouter)
   * @param schema - The schema for each route item
   * @returns A RecordSchema configured as a router
   */
  readonly router: typeof router;
  /**
   * Define a collection of images.
   *
   * @example
   * ```typescript
   * const schema = s.images({
   *   accept: "image/webp",
   *   directory: "/public/val/images",
   *   alt: s.string().minLength(4),
   * });
   * export default c.define("/content/images.val.ts", schema, {
   *   "/public/val/images/hero.webp": {
   *     width: 1920,
   *     height: 1080,
   *     mimeType: "image/webp",
   *     alt: "Hero image",
   *   },
   * });
   * ```
   */
  readonly images: typeof images;
  /**
   * Define a collection of files.
   *
   * @example
   * ```typescript
   * const schema = s.files({
   *   accept: "application/pdf",
   *   directory: "/public/val/documents",
   * });
   * export default c.define("/content/documents.val.ts", schema, {
   *   "/public/val/documents/report.pdf": {
   *     mimeType: "application/pdf",
   *   },
   * });
   * ```
   */
  readonly files: typeof files;
  /**
   * Define the project's settings.
   *
   * One per project, at the root of the content tree — a module file path with
   * no directory segment, `/settings.val.ts` by convention. Every section is
   * optional, so `{}` is a complete settings module and stays one as sections
   * are added.
   *
   * @example
   * ```typescript
   * export default c.define("/settings.val.ts", s.settings(), {});
   * ```
   *
   * @example
   * ```typescript
   * export default c.define("/settings.val.ts", s.settings(), {
   *   assistant: {
   *     enabled: true,
   *     context: "A CMS for developers. British English throughout.",
   *     tone: "Plain and direct. Sentence case in headings.",
   *   },
   * });
   * ```
   */
  readonly settings: typeof settings;
};
// export type InitSchemaLocalized<Locales extends readonly string[]> = {
//   readonly i18n: I18n<Locales>;
// };
export function initSchema() {
  // locales: F.Narrow<Locales>
  return {
    string,
    boolean,
    array,
    object,
    number,
    union,
    // oneOf,
    richtext,
    image,
    literal,
    keyOf,
    record,
    file,
    files,
    date,
    datetime,
    color,
    code,
    locale,
    route,
    router,
    images,
    settings,
    // i18n: i18n(locales),
  };
}
