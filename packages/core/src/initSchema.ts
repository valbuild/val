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
// import { i18n, I18n } from "./schema/future/i18n";
// import { oneOf } from "./schema/future/oneOf";

export type InitSchema = {
  readonly string: typeof string;
  readonly boolean: typeof boolean;
  readonly array: typeof array;
  readonly object: typeof object;
  readonly number: typeof number;
  readonly union: typeof union;
  // readonly oneOf: typeof oneOf;
  readonly richtext: typeof richtext;
  readonly image: typeof image;
  readonly literal: typeof literal;
  readonly keyOf: typeof keyOf;
  readonly record: typeof record;
  readonly file: typeof file;
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
    // i18n: i18n(locales),
  };
}
