"use client";

import { ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_APP_ID, VERSION as UIVersion } from "@valbuild/ui";
import { VAL_READY_MESSAGE_TYPE } from "@valbuild/shared/internal";
import Script from "next/script";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { cn, valPrefixedClass } from "./cssUtils";
import { canvasDarkBg, canvasLightBg } from "./fallbackColors";

export const ValApp = ({
  config,
  children,
}: {
  config: ValConfig;
  children?: ReactNode;
}) => {
  const route = "/api/val"; // TODO: make configurable
  const [inMessageMode, setInMessageMode] = useState<boolean>();
  const isClientSIde = inMessageMode === undefined;
  useConfigStorageSave(config);
  const container = useRef<HTMLDivElement>(null);
  /**
   * The legacy landing page for the draft-mode iframe.
   *
   * Kept for a `redirect_to` that was already in flight, and for a hosted
   * `valEnableRedirectUrl` chain still pointing here. The normal path is
   * `/api/val/draft/ready` — plain HTML with no Next client bundle, because
   * loading this route in an iframe reloads the Studio (see
   * `VAL_DRAFT_READY_PATH`).
   *
   * The interval has a delay. It was created with none, which in an iframe that
   * lives until its parent hears the message meant posting as fast as the event
   * loop allowed, on the same dev server that is compiling. Repeated at all
   * because the parent attaches its listener when the iframe mounts and a fast
   * load can beat it; bounded so a parent that never hears it leaves a stopped
   * timer rather than a running one.
   */
  useEffect(() => {
    if (location.search !== "?message_onready=true") {
      setInMessageMode(false);
      return;
    }
    setInMessageMode(true);
    let sent = 0;
    const announce = () => {
      window.parent.postMessage({ type: VAL_READY_MESSAGE_TYPE }, "*");
      sent++;
      if (sent > 20) {
        clearInterval(interval);
      }
    };
    const interval = setInterval(announce, 250);
    announce();
    return () => {
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (container.current?.childElementCount === 0) {
      window.dispatchEvent(new CustomEvent("val-append-studio"));
    }
  });

  // this theme is used to avoid flickering
  const [loadingTheme, setLoadingTheme] = useState<string | null>(
    config.defaultTheme || null,
  );
  useEffect(() => {
    const theme = localStorage.getItem(
      "val-theme-" + (config?.project || "unknown"),
    );
    if (theme === "dark") {
      setLoadingTheme("dark");
    } else if (theme === "light") {
      setLoadingTheme("light");
    } else if (config.defaultTheme) {
      setLoadingTheme(config.defaultTheme);
    }
  }, [config]);
  // The studio's canvas, so the loading screen is the same colour as what
  // replaces it rather than a flash of a different one.
  const darkBg = canvasDarkBg;
  const lightBg = canvasLightBg;
  useEffect(() => {
    if (inMessageMode || loadingTheme === null) {
      return;
    }
    const body = document.body;
    const prevBodyBg = body.style.backgroundColor;
    const prevBodyMinHeight = body.style.minHeight;
    const prevBodyMinWidth = body.style.minWidth;
    body.style.backgroundColor = loadingTheme === "dark" ? darkBg : lightBg;
    body.style.minHeight = "100vh";
    body.style.minWidth = "100%";
    window.addEventListener("val-css-loaded", () => {
      // css was loaded, has been loaded, so let app decide what to do
      setLoadingTheme(null);
    });
    return () => {
      body.style.backgroundColor = prevBodyBg;
      body.style.minHeight = prevBodyMinHeight;
      body.style.minWidth = prevBodyMinWidth;
      window.removeEventListener("val-css-loaded", () => {
        setLoadingTheme(null);
      });
    };
  }, [inMessageMode, loadingTheme]);

  if (loadingTheme !== null && isClientSIde) {
    return (
      <div
        style={{
          color: loadingTheme === "dark" ? "white" : "black",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "1rem",
          backgroundColor: loadingTheme === "dark" ? darkBg : lightBg,
          minHeight: "100vh",
          minWidth: "100%",
        }}
      >
        <style>
          {`.${valPrefixedClass}animate-spin {
  animation: ${valPrefixedClass}spin 2s linear infinite;
}
@keyframes ${valPrefixedClass}spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}`}
        </style>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(["animate-spin"])}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    );
  }
  if (inMessageMode) {
    return <div>Val Studio is disabled: in message mode</div>;
  }
  return (
    <>
      <Script
        type="module"
        src={`${route}/static${UIVersion ? `/${UIVersion}` : ""}${VAL_APP_PATH}`}
        crossOrigin="anonymous"
      />
      <div id={VAL_APP_ID} ref={container}></div>
      {children}
    </>
  );
};
