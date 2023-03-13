import { content } from "./module";
import { array } from "./schema/array";
import { object } from "./schema/object";
import { string } from "./schema/string";

const defaultVal = {
  val: {
    content,
  },
  s: {
    string,
    object,
    array,
  },
};

export type InitVal = typeof defaultVal;
export const initVal = (): InitVal => {
  return defaultVal;
};
