import { ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_APP_ID, VERSION as UIVersion } from "@valbuild/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { cn, valPrefixedClass } from "./cssUtils";
import { canvasDarkBg, canvasLightBg } from "./fallbackColors";
import { ValScript } from "./ValScript";
import type { ValDemoRuntime } from "@valbuild/shared/internal";
import { startDemoRelay } from "./demo/demoRelayHost";

/**
 * How often the embedded Studio announces itself to the opener.
 *
 * It repeats because the parent's `message` listener may not be attached yet
 * when this frame first loads, and it does not need an ACK: the parent clears
 * `iframeSrc` on the first one it receives, which unmounts this frame and
 * takes the interval with it. 100ms matches the parent's own
 * `DRAFT_HANDSHAKE_POLL_MS`, so the two sides of the handshake tick together.
 *
 * `setInterval` was previously called with NO delay, which is a 0ms interval —
 * a `postMessage` every tick of the event loop for as long as the handshake
 * took.
 */
const VAL_READY_PING_MS = 100;

export const ValApp = ({
  config,
  children,
  demo,
}: {
  config: ValConfig;
  children?: ReactNode;
  /**
   * Run the Studio as a demo: no sign-in, and no request leaves the tab.
   *
   * Val's own server is started here, in the browser, in memory mode, and the
   * Studio's requests go to it instead of to `/api/val`. Edits live in memory:
   * they last as long as this page does, and a reload starts over. Pair it
   * with `initValDemoServer` on the API route, which serves the Studio's files
   * and nothing else, and with `<ValProvider demo>` on the site so the canvas
   * shows the edits.
   *
   * Set it from the build -- `demo={import.meta.env.VITE_VAL_DEMO === "true"}`
   * -- never from anything a visitor controls.
   */
  demo?: boolean;
}) => {
  const route = "/api/val"; // TODO: make configurable
  const demoReady = useDemoServer(demo === true, config);
  const [inMessageMode, setInMessageMode] = useState<boolean>();
  const isClientSIde = inMessageMode === undefined;
  useConfigStorageSave(config);
  const container = useRef<HTMLDivElement>(null);
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
      }, VAL_READY_PING_MS);
      return () => {
        clearInterval(interval);
      };
    } else {
      setInMessageMode(false);
    }
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
    // A stable reference: `removeEventListener` compares by identity, so a
    // second arrow function removes nothing and every re-run of this effect
    // used to leave another listener behind.
    const onCssLoaded = () => {
      // css was loaded, has been loaded, so let app decide what to do
      setLoadingTheme(null);
    };
    window.addEventListener("val-css-loaded", onCssLoaded);
    return () => {
      body.style.backgroundColor = prevBodyBg;
      body.style.minHeight = prevBodyMinHeight;
      body.style.minWidth = prevBodyMinWidth;
      window.removeEventListener("val-css-loaded", onCssLoaded);
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
  if (demo && !demoReady) {
    // The Studio reads `window.__VAL_DEMO__` when its script starts, so the
    // server it talks to has to be there first. The modules are registered
    // by a child (`ValModulesClient`), whose effect has run by then.
    return <>{children}</>;
  }
  return (
    <>
      <ValScript
        src={`${route}/static${UIVersion ? `/${UIVersion}` : ""}${VAL_APP_PATH}`}
      />
      <div id={VAL_APP_ID} ref={container}></div>
      {children}
    </>
  );
};

/**
 * Starts Val's server in this tab, and hands it to the Studio.
 *
 * Loaded on demand: `@valbuild/server/browser` is the whole request-handling
 * half of the server, and only a demo should download it.
 */
function useDemoServer(demo: boolean, config: ValConfig): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    void import("@valbuild/server/browser").then(
      async ({ createInTabValFetch }) => {
        if (cancelled) return;
        const modules = window.__VAL_MODULES__;
        if (!modules) {
          console.error(
            "Val: the demo needs the project's modules. Render <ValModulesClient modules={valModules} /> inside <ValApp demo>.",
          );
          return;
        }
        const fetch = createInTabValFetch(modules, { config });
        const uploads = await startDemoRelay(fetch);
        if (cancelled) return;
        const runtime: ValDemoRuntime = { fetch, uploads };
        window.__VAL_DEMO__ = runtime;
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [demo, config]);
  return ready;
}
