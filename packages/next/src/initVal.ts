import { initVal as createValSystem, type InitVal } from "@valbuild/core";

export const initVal = (config?: { valConfigPath?: string }): InitVal => {
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
