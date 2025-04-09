"use client";

import { ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_APP_ID } from "@valbuild/ui";
import Script from "next/script";
import { useEffect, useState } from "react";
import { useRemoteConfigSender } from "./useRemoteConfigSender";

// eslint-disable-next-line no-empty-pattern
export const ValApp = ({ config }: { config: ValConfig }) => {
  const route = "/api/val"; // TODO: make configurable
  const [inMessageMode, setInMessageMode] = useState<boolean>();

  useRemoteConfigSender(config);
  useEffect(() => {
    if (location.search === "?message_onready=true") {
      setInMessageMode(true);
      const interval = setInterval(() => {
        window.parent.postMessage(
          {
            type: "val-ready",
          },
          "*",
        );
      });
      return () => {
        clearInterval(interval);
      };
    } else {
      setInMessageMode(false);
    }
  }, []);
  if (inMessageMode === undefined) {
    return null;
  }
  if (inMessageMode === true) {
    return <div>Val Studio is disabled: in message mode</div>;
  }
  return (
    <>
      <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
      <div id={VAL_APP_ID}></div>
    </>
  );
};
