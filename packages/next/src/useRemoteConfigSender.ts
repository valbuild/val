import { DEFAULT_CONTENT_HOST, Internal, ValConfig } from "@valbuild/core";
import {
  SharedValConfig,
  VAL_CONFIG_LISTENER,
  VAL_CONFIG_RECEIVED_LISTENER,
} from "@valbuild/shared/internal";
import React from "react";
("react");

const textEncoder = new TextEncoder();
/*
 * See the useRemoteConfigReceiver.tsx for the sender
 */
export function useRemoteConfigSender(config: ValConfig) {
  const [sentRemoteConfigHash, setSentRemoteConfigHash] = React.useState<
    string | null
  >(null);
  const [receivedRemoteConfigHash, setReceivedRemoteConfigHash] =
    React.useState<string | null>(null);
  React.useEffect(() => {
    const sendConfig = () => {
      const sharedConfig: SharedValConfig = {
        ...config,
        // We're in NextJS now, so we can get process.env variables
        contentHostUrl: process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST,
      };
      const hash = Internal.getSHA256Hash(
        textEncoder.encode(JSON.stringify(sharedConfig)),
      );
      setSentRemoteConfigHash(hash);
      window.dispatchEvent(
        new CustomEvent(VAL_CONFIG_LISTENER, {
          detail: {
            type: "val-config",
            config,
            hash,
          },
        }),
      );
    };
    if (
      sentRemoteConfigHash === null ||
      sentRemoteConfigHash !== receivedRemoteConfigHash
    ) {
      sendConfig();
      const interval = setInterval(() => {
        sendConfig();
      }, 1000);
      return () => {
        clearInterval(interval);
      };
    }
  }, [config, receivedRemoteConfigHash, sentRemoteConfigHash]);
  React.useEffect(() => {
    const configListener = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        console.warn(
          "Received message of type val-config, but it was not a CustomEvent",
          event,
        );
        return;
      }
      if (event.detail.type !== "val-config-received") {
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
      setReceivedRemoteConfigHash(hash);
    };
    window.addEventListener(VAL_CONFIG_RECEIVED_LISTENER, configListener);
    return () => {
      window.removeEventListener(VAL_CONFIG_RECEIVED_LISTENER, configListener);
    };
  }, [config]);
}
