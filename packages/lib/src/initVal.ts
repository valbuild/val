import { object } from "./schema/object";
import { string } from "./schema/string";

export const initVal = () => {
  return {
    s: {
      string,
      object,
    },
  };
};
