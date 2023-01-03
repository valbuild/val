import { content } from "./content";
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
    },
  };
};
