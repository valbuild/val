"use client";
import { ValStudio } from "./components/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { fallbackRender } from "./fallbackRender";
import { useMemo, useState } from "react";
import {
  createValClient,
  getValDemo,
  VAL_CONFIG_SESSION_STORAGE_KEY,
  VAL_THEME_SESSION_STORAGE_KEY,
} from "@valbuild/shared/internal";
import { ValDemoContext } from "./demo/ValDemoContext";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH, VERSION } from "../src";
import { Fonts } from "./Fonts";
import { DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { useConfig } from "./hooks/useConfig";
import { useValModules } from "./hooks/useValModules";
import { Themes } from "./components/ValThemeProvider";

function App() {
  const config = useConfig();
  const valModules = useValModules();
  const host = "/api/val"; // TODO: make configurable
  /*
   * A demo is decided by the page before this script runs (`<ValApp demo>`
   * puts it on the window), so it is read once. In a demo the client's
   * requests go to Val's server in this tab rather than to `host`: the same
   * client, the same server code, no network. See `docs/plans/demo-mode.md`.
   */
  const [demo] = useState(getValDemo);
  const { client } = useMemo(() => {
    const client = createValClient(
      host,
      {
        ...config,
        contentHostUrl: DEFAULT_CONTENT_HOST,
      },
      demo ? { fetch: demo.fetch } : undefined,
    );
    return { client };
  }, [host, config, demo]);
  const [cssLoaded, setCssLoaded] = useState(false);
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
            <ValDemoContext.Provider value={demo}>
              <ValStudio
                client={client}
                config={config}
                valModules={valModules}
                cssLoaded={cssLoaded}
                theme={theme}
                setTheme={setTheme}
              />
            </ValDemoContext.Provider>
          </div>
        </ErrorBoundary>
      </ShadowRoot>
    </>
  );
}

export default App;
