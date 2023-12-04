import {
  initVal as createValSystem,
  ValConfig,
  type InitVal,
} from "@valbuild/core";

export const initVal = (config?: ValConfig): InitVal => {
  const { s, val, config: systemConfig } = createValSystem();
  const currentConfig = {
    ...systemConfig,
    ...config,
    valConfigPath: config?.valConfigPath || "./val.config",
  };
  return {
    s,
    val,
    config: currentConfig,
  };
};
