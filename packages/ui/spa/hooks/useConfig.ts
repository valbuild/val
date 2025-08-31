import {
  SharedValConfig,
  VAL_CONFIG_SESSION_STORAGE_KEY,
} from "@valbuild/shared/internal";
import { useEffect, useMemo, useState } from "react";

/*
 * See the useConfigStorageSave.tsx for the sender
 */
export function useConfig() {
  const [currentConfig, setCurrentConfig] = useState<SharedValConfig | null>(
    null,
  );
  const defaultConfig = useMemo(getConfigFromSessionStorage, []);
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key === VAL_CONFIG_SESSION_STORAGE_KEY) {
        setCurrentConfig(getConfigFromSessionStorage());
      }
    };
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener("storage", listener);
    };
  }, []);
  return currentConfig || defaultConfig;
}

function getConfigFromSessionStorage() {
  const config = sessionStorage.getItem(VAL_CONFIG_SESSION_STORAGE_KEY);
  if (config) {
    const sharedConfig = SharedValConfig.safeParse(JSON.parse(config));
    if (sharedConfig.error) {
      console.error(
        "Error parsing config from session storage",
        sharedConfig.error,
      );
      return null;
    }
    return sharedConfig.data;
  }
  return null;
}
