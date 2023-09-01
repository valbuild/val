import type { F } from "ts-toolbelt";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { boolean } from "./schema/boolean";
import { oneOf } from "./schema/oneOf";
import { union } from "./schema/union";
import { i18n, I18n } from "./schema/i18n";
import { richtext } from "./schema/richtext";
import { image } from "./schema/image";
import { literal } from "./schema/literal";

export type InitSchema = {
  readonly string: typeof string;
  readonly boolean: typeof boolean;
  readonly array: typeof array;
  readonly object: typeof object;
  readonly number: typeof number;
  readonly union: typeof union;
  readonly oneOf: typeof oneOf;
  readonly richtext: typeof richtext;
  readonly image: typeof image;
  readonly literal: typeof literal;
};
export type InitSchemaLocalized<Locales extends readonly string[]> = {
  readonly i18n: I18n<Locales>;
};
export function initSchema<Locales extends readonly string[]>(
  locales: F.Narrow<Locales>
) {
  return {
    string,
    boolean,
    array,
    object,
    number,
    union,
    oneOf,
    richtext,
    image,
    literal,
    i18n: i18n(locales),
  };
}
