import { initVal as createValSystem, type InitVal } from "@valbuild/core";
import { stegaClean, ValEncodedString } from "@valbuild/react/stega";

export const initVal = (config?: {
  valConfigPath?: string;
}): InitVal & {
  val: InitVal["val"] & {
    raw: (encodedString: ValEncodedString) => string;
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
      raw: (encodedString: ValEncodedString): string => {
        return stegaClean(encodedString);
      },
    },
    config: currentConfig,
  };
};
