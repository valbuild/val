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
import { date } from "./schema/date";
import { route } from "./schema/route";
import { router } from "./schema/router";
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
   * Use c.image to create an image source.
   *
   * @example
   * const schema = s.image();
   * export default c.define("/example.val.ts", schema, c.image("/public/val/example.png", {
   *  width: 100,
   *  height: 100,
   *  mimeType: "image/png",
   *  hotspot: {
   *    x: 0.5,
   *    y: 0.5
   *  }
   * }));
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
   * const schema = s.keyOf(s.string());
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
   * Use `c.file` to create a file source.
   *
   * @example
   * const schema = s.file();
   * export default c.define("/example.val.ts", schema, c.file("/public/val/example.png"));
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
   * Define a route.
   *
   * @example
   * const schema = s.route();
   * export default c.define("/example.val.ts", schema, "/example");
   *
   */
  readonly route: typeof route;
  /**
   * Define a router record.
   * This is a shorthand for `s.record(item).router(router)`.
   *
   * @example
   * const schema = s.router(nextAppRouter, s.object({ title: s.string() }));
   * export default c.define("/example.val.ts", schema, {
   *   "/home": { title: "Home" },
   *   "/about": { title: "About" }
   * });
   *
   */
  readonly router: typeof router;
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
    date,
    route,
    router,
    // i18n: i18n(locales),
  };
}
