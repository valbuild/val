/* eslint-disable @typescript-eslint/no-explicit-any */
import { Internal } from "@valbuild/core";
import { Style, ValOverlay } from "@valbuild/ui";
import { useEffect, useState } from "react";
import { ShadowRoot } from "./ShadowRoot";
import { useValApi } from "./ValProvider";

export default function ValUI() {
  const [isClient, setIsClient] = useState(false);
  const [enabled, setEnabled] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isDraftMode, setDraftMode] = useState(false); // TODO: if enabled, but not in draft mode: show something
  const api = useValApi();
  useEffect(() => {
    setIsClient(true);
    try {
      const valEnabled = document.cookie?.includes(
        `${Internal.VAL_ENABLE_COOKIE_NAME}=true`
      );
      setEnabled(valEnabled);
    } catch (e) {
      console.warn("Could not read Val enabled state", e);
    }
    try {
      const valDraftMode = document.cookie?.includes(
        `${Internal.VAL_DRAFT_MODE_COOKIE}=true`
      );
      setDraftMode(valDraftMode);
    } catch (e) {
      console.warn("Could not read Val draft mode", e);
    }
  }, []);
  if (isClient && !enabled && process.env.NODE_ENV === "development") {
    console.log(
      `Val is disabled. Enable it by going here ${window.origin}${
        api.host
      }/enable?redirect_to=${encodeURIComponent(
        window.location.href
      )}. NOTE: this message appears because NODE_ENV is set to development.`
    );
  }
  if (!isClient || !enabled) {
    return null;
  }
  return (
    <>
      <ShadowRoot>
        {/* TODO: */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400;1,700&display=swap"
          rel="stylesheet"
        />
        <Style />
        <ValOverlay api={api} />
      </ShadowRoot>
    </>
  );
}
