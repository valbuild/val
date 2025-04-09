import { ValConfig } from "@valbuild/core";
import {
  SharedValConfig,
  VAL_CONFIG_LISTENER,
  VAL_CONFIG_RECEIVED_LISTENER,
} from "@valbuild/shared/internal";
import { useEffect, useState } from "react";

/*
 * See the useRemoteConfigSender.tsx for the sender
 */
export function useRemoteConfigReceiver() {
  const [config, setConfig] = useState<ValConfig | null>(null);
  useEffect(() => {
    const configListener = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        console.warn(
          "Received message of type val-config, but it was not a CustomEvent",
          event,
        );
        return;
      }
      if (event.detail.type !== "val-config") {
        console.warn(
          "Received message of type val-config, but it did not have the expected type",
          event.detail,
        );
        return;
      }
      const hash = event.detail.hash;
      if (!hash) {
        console.warn(
          "Received message of type val-config, but it did not have a hash",
          event.detail,
        );
        return;
      }
      const input = event.detail.config;
      const parsedConfig = SharedValConfig.safeParse(input);
      if (parsedConfig.success) {
        setConfig(parsedConfig.data);
      } else {
        console.error("Invalid config. Recreating...", parsedConfig.error);
        // Try to load re-create the most critical parts of  configuration
        // TODO: why not only do this? Find a more elegant way? Can we use zod to extract what at least matches the schema?
        setConfig({
          project:
            typeof input?.project === "string" ? input.project : undefined,
          root: typeof input?.root === "string" ? input.root : undefined,
          gitCommit:
            typeof input?.gitCommit === "string" ? input.gitCommit : undefined,
          ai: input?.ai
            ? input.ai.commitMessages
              ? typeof input.ai.commitMessages.disabled === "boolean"
                ? {
                    commitMessages: {
                      disabled: input.ai.commitMessages.disabled,
                    },
                  }
                : undefined
              : undefined
            : undefined,
          files: input?.files
            ? {
                directory:
                  typeof input?.files?.directory === "string"
                    ? input.files.directory
                    : "/public/val",
              }
            : undefined,
          gitBranch:
            typeof input?.gitBranch === "string" ? input.gitBranch : undefined,
          defaultTheme: input?.defaultTheme === "dark" ? "dark" : "light",
        });
      }
      window.dispatchEvent(
        new CustomEvent(VAL_CONFIG_RECEIVED_LISTENER, {
          detail: {
            type: "val-config-received",
            hash: hash,
          },
        }),
      );
    };
    window.addEventListener(VAL_CONFIG_LISTENER, configListener);
    return () => {
      window.removeEventListener(VAL_CONFIG_LISTENER, configListener);
    };
  }, []);
  return config;
}
