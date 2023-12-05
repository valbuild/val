import {
  initVal as createValSystem,
  ValConfig,
  type InitVal,
} from "@valbuild/core";
import { stegaClean, ValEncodedString } from "@valbuild/react/stega";

export const initVal = (config?: ValConfig): InitVal => {
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
      raw: (encodedString: ValEncodedString): string => {
        return stegaClean(encodedString);
      },
    },
    config: currentConfig,
  };
};
