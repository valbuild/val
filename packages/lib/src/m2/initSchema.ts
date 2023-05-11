import { F } from "ts-toolbelt";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { boolean } from "./schema/boolean";
import { oneOf } from "./schema/oneOf";
import { union } from "./schema/union";
import { i18n } from "./schema/i18n";

export function initSchema<Locales extends string[]>(
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
    i18n: i18n(locales),
  };
}
