import { content } from "./content";
import { array } from "./schema/array";
import { object } from "./schema/object";
import { string } from "./schema/string";

export const initVal = () => {
  return {
    val: {
      content,
    },
    s: {
      string,
      object,
      array,
    },
  };
};
