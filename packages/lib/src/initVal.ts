import { content } from "./module";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { i18n } from "./schema/i18n";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { image } from "./schema/image";
import { file } from "./file";

const defaultVal = {
  val: {
    content,
    file,
  },
  s: {
    array,
    i18n,
    number,
    object,
    string,
    image,
  },
};

export type InitVal = typeof defaultVal;
export const initVal = (): InitVal => {
  return defaultVal;
};
