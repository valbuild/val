import { ValConfig, Internal } from "@valbuild/core";
import { VAL_APP_PATH, VAL_APP_ID, VERSION as UIVersion } from "@valbuild/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { cn, valPrefixedClass } from "./cssUtils";
import { canvasDarkBg, canvasLightBg } from "./fallbackColors";
import { ValScript } from "./ValScript";
import type { ValDemoOptions, ValDemoRuntime } from "@valbuild/shared/internal";
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

/**
 * Whether the Studio's stylesheet has loaded in this page. `val-css-loaded`
 * fires once per page, so a `ValApp` that mounts again after it -- the `/val`
 * route left and come back to -- must not wait for it a second time.
 */
let studioStylesLoaded = false;

/**
 * The longest the loading screen covers the page. Past it, whatever the Studio
 * shows -- unstyled, or its own error -- is better than a spinner that never
 * ends.
 */
const LOADING_SCREEN_MAX_MS = 15_000;

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
   *
   * Options instead of `true` give the demo tours of the site's own:
   * `demo={{ tours, audiences }}`, written as data (`ValDemoOptions`), so what
   * they say changes with the site rather than with a Val release.
   */
  demo?: boolean | ValDemoOptions;
}) => {
  const route = "/api/val"; // TODO: make configurable
  const [inMessageMode, setInMessageMode] = useState<boolean>();
  const isClientSIde = inMessageMode === undefined;
  // Not before `children` are rendered, which is not on the first render: the
  // modules the demo's server needs are registered by one of them
  // (`ValModulesClient`), and a child's effects run before this component's
  // in the commit that mounts it. Started on the first render, the demo read
  // them whenever the server's code had loaded -- before the child was there,
  // on a page that had that code already.
  const demoStart = useDemoServer(
    demo !== undefined && demo !== false && inMessageMode === false,
    config,
    demo === undefined || typeof demo === "boolean" ? undefined : demo,
  );
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

  /*
   * Whether the loading screen still covers the page: until the Studio's
   * stylesheet has loaded, or the wait runs out. Its own state rather than
   * `loadingTheme`, which a new `config` sets again after the event has fired.
   */
  const [covering, setCovering] = useState(() => !studioStylesLoaded);
  useEffect(() => {
    if (!covering) {
      return;
    }
    const onCssLoaded = () => {
      studioStylesLoaded = true;
      setCovering(false);
    };
    window.addEventListener("val-css-loaded", onCssLoaded);
    const timeout = setTimeout(() => setCovering(false), LOADING_SCREEN_MAX_MS);
    return () => {
      window.removeEventListener("val-css-loaded", onCssLoaded);
      clearTimeout(timeout);
    };
  }, [covering]);

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

  /*
   * The loading screen stays up until the Studio's stylesheet has loaded, as
   * an overlay above the Studio mounting underneath it. It used to be rendered
   * INSTEAD of the Studio and dropped at hydration, which was before the
   * Studio's script had even been requested: the spinner went, an empty page
   * stood there while the Studio downloaded, and then the Studio appeared.
   * It is the first element both in the server render and after, so hydration
   * keeps it rather than restarting it. Only with a theme to draw it in --
   * `config.defaultTheme`, as the templates set -- as before.
   */
  const loadingScreen =
    !covering || loadingTheme === null || inMessageMode ? null : (
      <div
        style={{
          color: loadingTheme === "dark" ? "white" : "black",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "1rem",
          backgroundColor: loadingTheme === "dark" ? darkBg : lightBg,
          position: "fixed",
          inset: 0,
          zIndex: 2147483647,
        }}
      >
        <style>
          {`.${valPrefixedClass}animate-spin {
  display: inline-flex;
  animation: ${valPrefixedClass}spin 2s linear infinite;
  will-change: transform;
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
        {/* The span spins, not the SVG: Safari wobbles a spinning SVG that
            sits at a fractional pixel offset, which centring produces. */}
        <span className={cn(["animate-spin"])}>
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
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </span>
      </div>
    );
  if (isClientSIde && loadingScreen !== null) {
    return loadingScreen;
  }
  if (inMessageMode) {
    return <div>Val Studio is disabled: in message mode</div>;
  }
  if (demo && demoStart.status === "failed") {
    return (
      <>
        <DemoStartFailed failure={demoStart} />
        {children}
      </>
    );
  }
  if (demo && demoStart.status !== "ready") {
    // The Studio reads `window.__VAL_DEMO__` when its script starts, so the
    // server it talks to has to be there first. The children are rendered
    // meanwhile: one of them registers the modules that server is started
    // with.
    return <>{children}</>;
  }
  return (
    <>
      {loadingScreen}
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
type DemoStart =
  | { status: "starting" }
  | { status: "ready" }
  | {
      status: "failed";
      /** What happened, for the person looking at the page. */
      message: string;
      /** The error itself, for whoever they report it to. */
      details: string | null;
      /** Whether loading the page again can help. */
      retryable: boolean;
    };

function useDemoServer(
  demo: boolean,
  config: ValConfig,
  options: ValDemoOptions | undefined,
): DemoStart {
  const [start, setStart] = useState<DemoStart>({ status: "starting" });
  /*
   * Read when the demo starts, and not a dependency of the effect: options
   * written inline (`demo={{ tour }}`) are a new object on every render, and
   * starting Val's server again for each would throw away every edit. The
   * Studio reads them once anyway, when its script starts.
   */
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    const run = async (): Promise<DemoStart> => {
      const { createInTabValFetch } = await import("@valbuild/server/browser");
      const modules = window.__VAL_MODULES__;
      if (!modules) {
        return {
          status: "failed",
          message:
            "This demo was built without its content. Render <ValModulesClient modules={valModules} /> inside <ValApp demo>.",
          details: null,
          retryable: false,
        };
      }
      const fetch = createInTabValFetch(modules, { config });
      const uploads = await startDemoRelay(fetch);
      const { tour, tours, audiences } = optionsRef.current ?? {};
      const runtime: ValDemoRuntime = {
        fetch,
        uploads,
        ...(tour ? { tour } : {}),
        ...(tours ? { tours } : {}),
        ...(audiences ? { audiences } : {}),
      };
      window.__VAL_DEMO__ = runtime;
      return { status: "ready" };
    };
    run()
      .catch((err: unknown): DemoStart => {
        Internal.log.error("the demo could not start", err);
        return {
          status: "failed",
          // Most often the server's code did not download: the page is fine,
          // and loading it again fetches it again.
          message: "The demo could not start: part of it did not load.",
          details: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
      })
      .then((result) => {
        if (!cancelled) setStart(result);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, config]);
  return start;
}

/**
 * Said on the page, not only in the console: without it a demo that failed
 * to start is a site with no Studio and no reason given. Plain styles, since
 * the Studio's stylesheet is exactly what has not loaded.
 */
function DemoStartFailed({
  failure,
}: {
  failure: Extract<DemoStart, { status: "failed" }>;
}) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: "1rem",
        right: "1rem",
        bottom: "1rem",
        maxWidth: "28rem",
        margin: "0 auto",
        padding: "1rem",
        borderRadius: "0.75rem",
        background: "white",
        color: "black",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.2)",
        fontFamily: "system-ui, sans-serif",
        fontSize: "0.875rem",
        lineHeight: 1.4,
        zIndex: 2147483647,
      }}
    >
      <p style={{ margin: 0 }}>{failure.message}</p>
      {failure.retryable && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: "0.75rem",
            padding: "0.375rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid #ccc",
            background: "#f4f4f4",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      )}
      {failure.details !== null && (
        <details style={{ marginTop: "0.75rem", color: "#555" }}>
          <summary style={{ cursor: "pointer" }}>Details</summary>
          <code style={{ wordBreak: "break-word" }}>{failure.details}</code>
        </details>
      )}
    </div>
  );
}
