import { content } from "./module";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { i18n } from "./schema/i18n";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { taggedUnion, literal } from "./schema/taggedUnion";

const defaultVal = {
  val: {
    content,
  },
  s: {
    array,
    i18n,
    number,
    object,
    string,
    taggedUnion,
    literal,
  },
};

export type InitVal = typeof defaultVal;
export const initVal = (): InitVal => {
  return defaultVal;
};
