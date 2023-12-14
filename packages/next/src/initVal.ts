import {
  initVal as createValSystem,
  type ValConfig,
  type InitVal,
  type ValConstructor,
} from "@valbuild/core";
import { raw } from "./raw";
import { decodeValPathOfString } from "./decodeValPathOfString";

export const initVal = (
  config?: ValConfig
): InitVal & {
  val: ValConstructor & {
    raw: typeof raw;
    decodeValPathOfString: typeof decodeValPathOfString;
  };
} => {
  const { s, val, config: systemConfig } = createValSystem();
  const currentConfig = {
    ...systemConfig,
    ...config,
    valConfigPath: config?.valConfigPath || "./val.config",
  };
  return {
    s,
    val: {
      ...val,
      decodeValPathOfString,
      raw,
    },
    config: currentConfig,
  };
};
