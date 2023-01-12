import { content } from "./content";
import { array } from "./schema/array";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { useVal } from "./useVal";

export const initVal = () => {
  return {
    val: {
      content,
    },
    useVal,
    s: {
      string,
      object,
      array,
    },
  };
};
