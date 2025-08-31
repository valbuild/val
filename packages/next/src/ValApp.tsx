"use client";

import { ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_APP_ID, VERSION as UIVersion } from "@valbuild/ui";
import Script from "next/script";
import { useEffect, useState } from "react";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { cn, valPrefixedClass } from "./cssUtils";

// eslint-disable-next-line no-empty-pattern
export const ValApp = ({ config }: { config: ValConfig }) => {
  const route = "/api/val"; // TODO: make configurable
  const [inMessageMode, setInMessageMode] = useState<boolean>();
  const isClientSIde = inMessageMode === undefined;
  useConfigStorageSave(config);
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
  const darkBg = "#0c111d";
  const lightBg = "white";
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
      <div id={VAL_APP_ID}></div>
    </>
  );
};
