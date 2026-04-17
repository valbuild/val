"use client";
import { ErrorBoundary } from "react-error-boundary";
import {
  createValClient,
  VAL_CONFIG_SESSION_STORAGE_KEY,
  VAL_THEME_SESSION_STORAGE_KEY,
} from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH } from "../src/constants";
import { fallbackRender, FallbackComponent } from "./fallbackRender";
import { ValOverlay } from "./components/ValOverlay";
import { ValRouter } from "./components/ValRouter";
import { useEffect, useState } from "react";
import { ValProvider } from "./components/ValProvider";
import { Themes } from "./components/ValThemeProvider";
import { Fonts } from "./Fonts";
import { DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { useConfig } from "./hooks/useConfig";
import { VERSION } from "../src";

function Overlay() {
  const config = useConfig();
  // Theme is initialized by ValNextProvider in session storage
  // We just read it once on init and then rely on React state
  const [theme, setTheme] = useState<Themes | null>(() => {
    try {
      const stored = sessionStorage.getItem(VAL_THEME_SESSION_STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
      const configRaw = sessionStorage.getItem(VAL_CONFIG_SESSION_STORAGE_KEY);
      const config = configRaw ? JSON.parse(configRaw) : null;
      const local = localStorage.getItem(
        "val-theme-" + (config?.project || "unknown"),
      );
      if (local === "light" || local === "dark") return local;
      if (config?.defaultTheme === "light" || config?.defaultTheme === "dark") {
        return config.defaultTheme;
      }
    } catch {
      // ignore storage errors
    }
    return "dark";
  });
  const host = "/api/val";
  const client = createValClient("/api/val", {
    ...config,
    contentHostUrl: DEFAULT_CONTENT_HOST,
  });

  const [draftMode, setDraftMode] = useState(false);
  const [draftModeLoading, setDraftModeLoading] = useState(false);
  useEffect(() => {
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (
          event?.detail.type === "draftMode" &&
          typeof event?.detail.value === "boolean"
        ) {
          setDraftMode(event.detail.value);
        } else if (
          event.detail.type === "draftModeLoading" &&
          typeof event.detail.value === "boolean"
        ) {
          setDraftModeLoading(event.detail.value);
        } else {
          console.error(
            "Val: invalid event detail (val-overlay-spa)",
            event.detail,
          );
        }
      } else {
        console.error("Val: invalid event (val-overlay-spa)", event);
      }
    };
    window.addEventListener("val-overlay-spa", listener);
    window.dispatchEvent(
      new CustomEvent("val-overlay-provider", {
        detail: {
          type: "spa-ready",
        },
      }),
    );
    return () => {
      window.removeEventListener("val-overlay-spa", listener);
    };
  }, []);
  return (
    <>
      <Fonts />
      <ShadowRoot>
        <style>{`
          #val-overlay-container {
            visibility: hidden;
          }
        `}</style>
        <link
          rel="stylesheet"
          href={`${host}/static${VERSION ? `/${VERSION}` : ""}${VAL_CSS_PATH}`}
        />
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ValProvider
            client={client}
            dispatchValEvents={draftMode}
            config={config}
            theme={theme}
            setTheme={setTheme}
          >
            <ErrorBoundary FallbackComponent={FallbackComponent}>
            <ValRouter overlay>
              <ValOverlay
                draftMode={draftMode}
                draftModeLoading={draftModeLoading}
                setDraftMode={(value: boolean) => {
                  const event = new CustomEvent("val-overlay-provider", {
                    detail: {
                      type: "draftMode",
                      value,
                    },
                  });
                  window.dispatchEvent(event);
                }}
                disableOverlay={() => {
                  location.href = `${
                    window.location.origin
                  }/api/val/disable?redirect_to=${encodeURIComponent(
                    window.location.href,
                  )}`;
                }}
              />
            </ValRouter>
            </ErrorBoundary>
          </ValProvider>
        </ErrorBoundary>
      </ShadowRoot>
    </>
  );
}

export default Overlay;
