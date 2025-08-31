import { ValConfig } from "@valbuild/core";
import { VAL_CONFIG_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";
import React from "react";

/*
 * See the useConfig.tsx where the config is loaded from session storage
 */
export function useConfigStorageSave(config: ValConfig) {
  React.useEffect(() => {
    sessionStorage.setItem(
      VAL_CONFIG_SESSION_STORAGE_KEY,
      JSON.stringify(config),
    );
  }, [config]);
}
