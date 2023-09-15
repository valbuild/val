import { initVal as createValSystem, type InitVal } from "@valbuild/core";

export const initVal = (): InitVal => {
  const { s, val } = createValSystem();

  return {
    s,
    val,
  };
};
