"use client";
import { ValStudio } from "./components/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { fallbackRender } from "./fallbackRender";
import { useMemo, useState } from "react";
import { createValClient, VAL_THEME_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH, VERSION } from "../src";
import { Fonts } from "./Fonts";
import { DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { useConfig } from "./hooks/useConfig";
import { Themes } from "./components/ValProvider";

function App() {
  const config = useConfig();
  const host = "/api/val"; // TODO: make configurable
  const { client } = useMemo(() => {
    const client = createValClient(host, {
      ...config,
      contentHostUrl: DEFAULT_CONTENT_HOST,
    });
    return { client };
  }, [host, config]);
  const [cssLoaded, setCssLoaded] = useState(false);
   // Theme is initialized by ValNextProvider in session storage
  // We just read it once on init and then rely on React state
  const [theme, setTheme] = useState<Themes | null>(() => {
    const storedTheme = sessionStorage.getItem(VAL_THEME_SESSION_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
    return null;
  });
  return (
    <>
      <Fonts />
      <ShadowRoot>
        <link
          rel="stylesheet"
          href={`${host}/static${VERSION ? `/${VERSION}` : ""}${VAL_CSS_PATH}`}
          onLoad={() => {
            // send an event that css is loaded:
            window.dispatchEvent(
              new CustomEvent("val-css-loaded", {
                detail: {
                  type: "val-css-loaded",
                },
              }),
            );
            setCssLoaded(true);
          }}
        />
        <ErrorBoundary fallbackRender={fallbackRender}>
          <div
            {...(theme ? { "data-mode": theme } : {})}
            className="bg-bg-primary font-sans text-fg-primary"
          >
            <ValStudio client={client} config={config} cssLoaded={cssLoaded} theme={theme} setTheme={setTheme} />
          </div>
        </ErrorBoundary>
      </ShadowRoot>
    </>
  );
}

export default App;
