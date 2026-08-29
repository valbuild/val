"use client";

import {
  DEFAULT_CONTENT_HOST,
  ModuleFilePath,
  ValConfig,
} from "@valbuild/core";
import {
  VAL_APP_PATH,
  VAL_OVERLAY_ID,
  VERSION as UIVersion,
} from "@valbuild/ui";
import { useRouter, usePathname } from "next/navigation";
import Script from "next/script";
import React, { useEffect } from "react";
import { ValExternalStore, ValOverlayProvider } from "./ValOverlayContext";
import { SET_AUTO_TAG_JSX_ENABLED } from "@valbuild/react/stega";
import { createValClient } from "@valbuild/shared/internal";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { initSessionTheme } from "./initSessionTheme";
import { cn, prefixStyles, valPrefixedClass } from "./cssUtils";
import { hasValEnableCookie } from "./valEnableCookie";
import { floatDarkBg, floatLightBg } from "./fallbackColors";
import { isValCanvasFrame } from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";
import { shouldSafetyRefresh } from "./safetyRefresh";

/**
 * Shows the Overlay menu and updates the store which the client side useVal hook uses to display data.
 */
/**
 * The floor between server re-renders.
 *
 * `router.refresh()` re-requests the whole route — Next has no per-module
 * invalidation — so this is about not queueing a request per keystroke, not
 * about batching for its own sake.
 */
const REFRESH_INTERVAL_MS = 500;

/**
 * How often the page re-reads the server on its own, without being told to.
 *
 * A safety net for a race no amount of care on this side can close. An edit is
 * applied to the client store immediately and saved to the server
 * asynchronously, so `router.refresh()` fired on the edit can reach a server
 * that has not written the patch yet: the RSC payload comes back with the old
 * content, the counter has already been cleared, and nothing schedules another
 * look. What you see is a canvas that flickered and did not change — which is
 * indistinguishable from an edit that did not work.
 *
 * The honest fix would be for the page to know when its patch has been
 * persisted, and it has no way to ask. So it asks again a little later instead.
 */
const SAFETY_REFRESH_MS = 10_000;

/**
 * How long after an edit the safety net keeps looking.
 *
 * The reason to stop is that this is a whole-route request: in development Next
 * re-renders (and sometimes recompiles) the page for every one, and a preview
 * nobody is editing has nothing to catch up on. So the net is armed by editing
 * and disarms itself when the editing stops — long enough after the last
 * keystroke that any write still in flight has certainly landed.
 */
const SAFETY_REFRESH_WINDOW_MS = 30_000;

/**
 * Fired on this window when an edit has been applied to the client store.
 *
 * The refresh loop listens for it so it can start the round trip immediately
 * rather than on its next tick. A DOM event rather than state, because the
 * counter it accompanies is a ref and the loop lives in an effect that must not
 * be torn down and rebuilt per keystroke.
 */
const VAL_EDIT_LANDED = "val-edit-landed";

/**
 * How often `/draft/stat` is asked when nothing is in progress.
 *
 * Draft mode changes when someone toggles it, which the handshake below already
 * covers — so this is only there to notice it being changed somewhere else.
 */
const DRAFT_IDLE_POLL_MS = 20_000;

/**
 * And how often while the enable/disable handshake is in flight.
 *
 * Fast on purpose: the hidden iframe redirects through `/draft/enable`, and the
 * page cannot do anything useful until that has landed.
 */
const DRAFT_HANDSHAKE_POLL_MS = 100;

/**
 * How long that fast phase may last before it gives up.
 *
 * Without a deadline it does not end: the only thing that clears `iframeSrc` is
 * a `val-ready` message posted by the redirect target, so a frame that fails to
 * load — a 500, an auth redirect, a dev server still compiling — left the page
 * asking ten times a second, forever. A browser runs about six connections per
 * origin, so that is enough to push `/stat`, `/patches` and the canvas document
 * itself into the browser's own queue, where they are indistinguishable from a
 * slow server.
 *
 * Generous enough for a first compile in `next dev`, which is the slowest case
 * that is not a fault.
 */
const DRAFT_HANDSHAKE_TIMEOUT_MS = 10_000;

export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
  /**
   * Opt in to Suspense gating for `useValStega` / `useValRouteStega`:
   * `<ValProvider config={config} suspend>`. Requires React 19 (`React.use`).
   *
   * When set, hooks suspend until draft data has loaded — but only when the
   * Val Enable cookie is present, which is detected client-side after
   * hydration. SSR and hydration always render the static committed source
   * (draft data is browser-only), the gate then activates inside a transition
   * so the static content stays visible while draft data loads. Production
   * visitors without the cookie pay no cost, and layouts stay synchronous and
   * routes static — do NOT wire this to a server-side cookie read like
   * `cookies()` from `next/headers`: that opts every route into dynamic
   * rendering.
   *
   * Must be constant for the lifetime of the page.
   *
   * When omitted (or `false`), `useValStega` never suspends — components
   * render with the static committed source and update on the client once
   * draft data has loaded.
   *
   * A route that exists ONLY in a draft is the case this is for, and the case
   * it does not fully cover: the render before the gate activates resolves
   * against committed source, and a page that answers a missing route with
   * `notFound()` cannot take that back. See `architecture/quirks.md`
   * ("`suspend` is three waits") for why, and the README section
   * "Previewing unpublished pages" for what to tell users.
   */
  suspend?: boolean;
}) => {
  // TODO: use config:
  const route = "/api/val";
  const client = React.useMemo(
    () =>
      createValClient(route, {
        ...props.config,
        contentHostUrl: DEFAULT_CONTENT_HOST,
      }),
    [route, props.config],
  );

  // TODO: move below into react package
  const valStore = React.useMemo(() => new ValExternalStore(), []);
  // Whether useValStega should actually suspend. False during SSR and the
  // hydration render — the server store is never populated (draft data
  // arrives via browser CustomEvents only), so suspending there would just
  // stall into the waitForLoad timeout, and hydration must render the static
  // source so it matches the server HTML exactly. Activated post-hydration
  // (in an effect, only when the Val Enable cookie is present) inside a
  // transition: React keeps the static content visible while hooks suspend
  // and then swaps to draft data as a normal update — no Suspense fallback
  // flash and no hydration mismatch.
  const [suspendActive, setSuspendActive] = React.useState(false);
  /**
   * Whether the studio has said it sent everything it holds.
   *
   * Until then, a module missing from the store might still be on its way. After
   * it, a missing module simply has no draft — see `sourcesSynced` in the canvas
   * protocol. Without this the page could only wait out `waitForLoad`'s timeout,
   * ten seconds per module nobody had edited.
   */
  const [draftSourcesSynced, setDraftSourcesSynced] = React.useState(false);
  const [mountOverlay, setMountOverlay] = React.useState<boolean>();
  /**
   * Whether this document is the studio's canvas frame.
   *
   * The canvas needs everything `mountOverlay` turns on — draft content,
   * `data-val-path` on every tracked element, the refresh loop that brings an
   * edit across — and none of what it *shows*, because the studio around the
   * frame is already that UI. So it is a second flag rather than a different
   * value of the first one: two overlays on one screen, one of them inside the
   * other, is the thing to avoid.
   *
   * Read once, in the same effect as `mountOverlay`: it is a property of how
   * the document was loaded, and it cannot change without a navigation.
   */
  const [isCanvas, setIsCanvas] = React.useState(false);
  const [draftMode, setDraftMode] = React.useState<boolean | null>(null);
  /**
   * Resolves when `draftMode` stops being unknown.
   *
   * `null` is the state before `/draft/stat` has answered, and it is NOT a
   * synonym for "off": the reader that turns a selector into content treats it
   * as off, so a render that happens while draft mode is still unknown resolves
   * against committed source. For a route that only exists in an uncommitted
   * patch that means `notFound()` — terminal, before the answer even arrives.
   *
   * So a page that is going to suspend waits for the answer first. A promise
   * rather than a re-render, because the thing that has to wait is a render.
   */
  const draftModeReady = React.useRef<{
    promise: Promise<void>;
    resolve: () => void;
  } | null>(null);
  // Only for a page that opted in. A visitor with Val off never reads it, and
  // an object created per mount for nobody is the kind of cost that is invisible
  // until it is in every page of every app.
  if (props.suspend && draftModeReady.current === null) {
    let resolve = () => undefined as void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    draftModeReady.current = { promise, resolve };
  }
  React.useEffect(() => {
    if (draftMode !== null) {
      draftModeReady.current?.resolve();
    }
  }, [draftMode]);
  const [spaReady, setSpaReady] = React.useState(false); // TODO: consider removing spaReady - it is not used? If we remove, clean up the custom events that send the message too...
  const router = useRouter();
  const [isRefreshing, startTransition] = React.useTransition();
  /**
   * The same answer as `isRefreshing`, readable from the refresh effect.
   *
   * The effect must not be rebuilt every time a refresh starts and ends — it
   * owns the timers and the "when did we last edit" bookkeeping, and tearing
   * that down mid-flurry loses it. A ref updated on render is the value without
   * the dependency.
   */
  const isRefreshingRef = React.useRef(false);
  const rerenderCounterRef = React.useRef(0);
  const [iframeSrc, setIframeSrc] = React.useState<string | null>(null);
  const pathname = usePathname();
  isRefreshingRef.current = isRefreshing;
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("val-provider:pathname", {
        detail: pathname,
      }),
    );
  }, [pathname]);

  useConsoleLogEnableVal(mountOverlay);
  React.useEffect(() => {
    if (location.search === "?message_onready=true") {
      console.warn("Val is verifying draft mode...");
      return;
    }
    if (isValStudioPath(location.pathname)) {
      setMountOverlay(false);
      return;
    }
    setIsCanvas(isValCanvasFrame(location.search));
    setMountOverlay(hasValEnableCookie(document.cookie));
  }, []);

  React.useEffect(() => {
    // Activate the Suspense gate after hydration. Inside a transition so
    // already-visible (static) content stays on screen while useValStega
    // suspends — no fallback flash — and the swap to draft data commits as a
    // normal update instead of a hydration mismatch. Never deactivated:
    // components must not stop suspending across renders (the draft-mode-off
    // release valve lives in useValStega instead).
    if (props.suspend && shouldEnableVal()) {
      startTransition(() => {
        setSuspendActive(true);
      });
    }
  }, [props.suspend]);

  /**
   * Re-render the server tree when an edit lands, then at most every 500ms.
   *
   * Leading edge, which is the whole point. This polled every 500ms and only
   * refreshed on the tick, so a keystroke waited up to half a second before the
   * round trip even began — pure dead time on top of a request that is already
   * the slow part in development. Refreshing on arrival and *then* enforcing the
   * gap keeps the same ceiling on requests while removing the wait.
   *
   * Still a counter rather than a boolean: edits that arrive during the gap have
   * to be picked up by the next refresh, and the count is what says whether
   * there are any.
   */
  React.useEffect(() => {
    if (!mountOverlay || props.disableRefresh) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;
    /** When an edit last landed here. 0 means this page has never been edited. */
    let lastEditAt = 0;
    /** Whether a safety tick was skipped because nobody was looking. */
    let missedWhileHidden = false;
    const refresh = () => {
      rerenderCounterRef.current = 0;
      lastRefreshAt = Date.now();
      startTransition(() => {
        router.refresh();
      });
    };
    const tick = () => {
      timer = null;
      if (rerenderCounterRef.current === 0) return;
      const since = Date.now() - lastRefreshAt;
      if (since >= REFRESH_INTERVAL_MS) {
        refresh();
      } else {
        timer = setTimeout(tick, REFRESH_INTERVAL_MS - since);
      }
    };
    const onEdit = () => {
      lastEditAt = Date.now();
      if (timer !== null) return;
      timer = setTimeout(tick, 0);
    };
    window.addEventListener(VAL_EDIT_LANDED, onEdit);
    // A backstop for the counter being bumped without the event — the two are
    // incremented in the same places today, but the poll is what made this
    // correct regardless of who bumped it.
    const interval = setInterval(tick, REFRESH_INTERVAL_MS);

    /**
     * The safety net: look again, whether or not anything told us to.
     *
     * The reasons not to are in `shouldSafetyRefresh`, where they can be tested.
     * `hidden` is the one this side has to remember something about: a skipped
     * tick is worth one look when the tab comes back.
     */
    const safetyTick = () => {
      if (document.hidden) {
        missedWhileHidden = true;
        return;
      }
      const go = shouldSafetyRefresh({
        now: Date.now(),
        lastEditAt,
        lastRefreshAt,
        hidden: false,
        isRefreshing: isRefreshingRef.current,
        windowMs: SAFETY_REFRESH_WINDOW_MS,
        minIntervalMs: REFRESH_INTERVAL_MS,
      });
      if (go) refresh();
    };
    const safety = setInterval(safetyTick, SAFETY_REFRESH_MS);
    /**
     * Coming back to the tab is worth one look.
     *
     * Otherwise a background tab skips its ticks and then has to wait out a
     * whole interval on return — which is exactly the moment someone is looking
     * at the page to see whether their edit took.
     */
    const onVisibilityChange = () => {
      if (document.hidden || !missedWhileHidden) return;
      missedWhileHidden = false;
      safetyTick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener(VAL_EDIT_LANDED, onEdit);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
      clearInterval(safety);
      if (timer !== null) clearTimeout(timer);
    };
  }, [mountOverlay, props.disableRefresh]);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    if (draftMode === null) {
      return;
    }
    const valProviderOverlayListener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (!event?.detail.type) {
          console.error(
            "Val: invalid event detail (val-overlay-provider)",
            event,
          );
        }
        if (event.detail.type === "spa-ready") {
          setSpaReady(true);
        } else if (
          event.detail.type === "draftMode" &&
          (typeof event.detail.value === "boolean" ||
            event.detail.value === null)
        ) {
          const draftMode = event.detail.value;
          if (draftMode === true) {
            setIframeSrc((prev) => {
              if (prev === null) {
                return `${route}/draft/enable?redirect_to=${encodeURIComponent(
                  window.location.origin + "/val?message_onready=true",
                )}`;
              }
              return prev;
            });
          } else if (draftMode === false) {
            setIframeSrc((prev) => {
              if (prev === null) {
                return `${route}/draft/disable?redirect_to=${encodeURIComponent(
                  window.location.origin + "/val?message_onready=true",
                )}`;
              }
              return prev;
            });
          }
        } else {
          console.error(
            "Val: invalid event detail (val-overlay-provider)",
            event.detail,
          );
        }
      } else {
        console.error("Val: invalid event (val-overlay-provider)", event);
      }
    };
    window.addEventListener("val-overlay-provider", valProviderOverlayListener);
    return () => {
      window.removeEventListener(
        "val-overlay-provider",
        valProviderOverlayListener,
      );
    };
  }, [mountOverlay, draftMode]);

  const pollDraftStatIdRef = React.useRef(0);
  React.useEffect(() => {
    // continuous polling to check for updates:

    let timeout: NodeJS.Timeout;
    function pollCurrentDraftMode() {
      if (!mountOverlay) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent("val-overlay-spa", {
          detail: {
            type: "draftModeLoading",
            value: iframeSrc !== null,
          },
        }),
      );
      const pollDraftStatId = ++pollDraftStatIdRef.current;
      client("/draft/stat", "GET", {})
        .then((res) => {
          if (pollDraftStatIdRef.current !== pollDraftStatId) {
            return;
          }
          if (res.status === null) {
            // ignore network errors
            return;
          }
          if (res.status === 401) {
            // Not authorized (e.g. stale Val Enable cookie after the session
            // expired): treat draft mode as off so useValStega's Suspense gate
            // is released instead of leaving draftMode stuck at null and
            // re-suspending into the waitForLoad timeout.
            setDraftMode(false);
            return;
          }
          if (res.status !== 200) {
            console.error("Val: could not get draft mode status", res);
            return;
          }
          setDraftMode((prev) => {
            if (prev !== res.json.draftMode) {
              rerenderCounterRef.current++;
              window.dispatchEvent(new Event(VAL_EDIT_LANDED));
              return res.json.draftMode;
            }
            return prev;
          });
        })
        .catch((err) => {
          console.error("Val: could not get draft mode status", err);
        })
        .finally(() => {
          if (pollDraftStatIdRef.current !== pollDraftStatId) {
            return;
          }
          pollDraftStatIdRef.current--;
          const handshaking = iframeSrc !== null;
          if (
            handshaking &&
            Date.now() - startedAt > DRAFT_HANDSHAKE_TIMEOUT_MS
          ) {
            /**
             * The handshake did not complete, so stop hammering.
             *
             * Clearing `iframeSrc` unmounts the hidden frame and takes the poll
             * back to its idle interval — which is the honest state: nothing is
             * in progress any more. Leaving it set is what made this
             * unrecoverable, because the ONLY other thing that clears it is the
             * `val-ready` message the frame never sent.
             */
            console.warn(
              "Val: draft mode did not confirm in time. Falling back to the " +
                "idle poll — try toggling preview again.",
            );
            setIframeSrc(null);
            return;
          }
          timeout = setTimeout(
            pollCurrentDraftMode,
            handshaking ? DRAFT_HANDSHAKE_POLL_MS : DRAFT_IDLE_POLL_MS,
          );
        });
    }
    /**
     * When this spell of polling began.
     *
     * The effect re-runs when `iframeSrc` changes, so for the fast phase this is
     * the moment the handshake started — which is what the deadline below is
     * measured from.
     */
    const startedAt = Date.now();
    pollCurrentDraftMode();
    return () => {
      clearTimeout(timeout);
    };
  }, [mountOverlay, iframeSrc]);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("val-overlay-spa", {
        detail: {
          type: "draftMode",
          value: draftMode ?? false,
        },
      }),
    );
  }, [mountOverlay, draftMode, spaReady]);

  React.useEffect(() => {
    if (!mountOverlay) {
      SET_AUTO_TAG_JSX_ENABLED(false);
    } else {
      if (draftMode) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        const reactServerComponentRefreshListener = (event: Event) => {
          if (event instanceof CustomEvent) {
            if (event.detail?.type === "sources-synced") {
              setDraftSourcesSynced(true);
              return;
            }
            if (event.detail?.type === "source-update") {
              const moduleFilePath = event.detail?.moduleFilePath;
              const source = event.detail?.source;
              if (typeof moduleFilePath === "string" && source !== undefined) {
                valStore.update(moduleFilePath as ModuleFilePath, source);
                if (!props.disableRefresh) {
                  rerenderCounterRef.current++;
                  window.dispatchEvent(new Event(VAL_EDIT_LANDED));
                }
              } else {
                console.error("Val: invalid event detail", event.detail);
              }
            } else {
              console.error(
                "Val: invalid custom event details (val-event)",
                event.detail,
              );
            }
          } else {
            console.error("Val: invalid custom event (val-event)", event);
          }
        };
        window.addEventListener(
          "val-event",
          reactServerComponentRefreshListener,
        );
        return () => {
          window.removeEventListener(
            "val-event",
            reactServerComponentRefreshListener,
          );
        };
      }
    }
  }, [mountOverlay, draftMode, props.disableRefresh]);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    const listener = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data.type === "val-ready") {
        setIframeSrc(null);
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, [mountOverlay]);
  const container = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (container.current?.childElementCount === 0) {
      window.dispatchEvent(new CustomEvent("val-append-overlay"));
    }
  });

  const [dropZone, setDropZone] = React.useState<string | null>(null);
  React.useEffect(() => {
    const storedDropZone = localStorage.getItem("val-menu-drop-zone-default");
    if (storedDropZone) {
      setDropZone(storedDropZone);
    } else {
      setDropZone("val-menu-right-center");
    }
  }, []);
  useConfigStorageSave(props.config);
  const initTheme = React.useMemo(
    () => initSessionTheme(props.config),
    [props.config],
  );
  const [spaLoaded, setSpaLoaded] = React.useState(false);
  React.useEffect(() => {
    const listener = () => {
      setSpaLoaded(true);
    };
    window.addEventListener("val-ui-created", listener);
    return () => {
      window.removeEventListener("val-ui-created", listener);
    };
  }, []);
  // The pill is Val's chrome floating over the customer's page, so it takes
  // the float background rather than the studio's canvas.
  const [backgroundColor, textColor] = React.useMemo((): [string, string] => {
    if (initTheme !== "light") {
      return [floatDarkBg, "white"];
    }
    return [floatLightBg, "black"];
  }, [initTheme]);
  const commonStyles = React.useMemo(() => {
    return {
      "backdrop-blur": "backdrop-filter: blur(10px);",
      "text-text-primary": `color: ${textColor};`,
      "bg-bg-primary": `background: ${backgroundColor};`,
      rounded: "border-radius: 0.25rem;",
      fixed: "position: fixed;",
      "bottom-4": "bottom: 1rem;",
      "right-12": "right: 3rem;",
      "right-16": "right: 4rem;",
      "p-4": "padding: 1rem;",
      "p-2": "padding: 0.5rem;",
      "p-1": "padding: 0.25rem;",
      flex: "display: flex;",
      "items-center": "align-items: center;",
      "justify-center": "justify-content: center;",
    };
  }, [valPrefixedClass]);

  return (
    <ValOverlayProvider
      draftMode={draftMode}
      draftModeReady={draftModeReady.current?.promise}
      draftSourcesSynced={draftSourcesSynced}
      suspend={suspendActive}
      store={valStore}
    >
      {props.children}
      {dropZone !== null &&
        !spaLoaded &&
        mountOverlay &&
        // The canvas frame loads no SPA, so its pill would spin for ever.
        !isCanvas &&
        initTheme !== null && (
          <React.Fragment>
            <style>
              {`
${positionStyles}
${prefixStyles(commonStyles)}
@keyframes rotate-clock {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
`}
            </style>
            {/* This same snippet is used in ValOverlay (ValMenu) - we use this to indicate when val is loading */}
            <div className={`${getPositionClassName(dropZone)} ${cn(["p-4"])}`}>
              <div
                className={
                  `${cn(["flex", "justify-center", "items-center", "p-2"])} ` +
                  `${cn(["text-text-primary", "bg-bg-primary", "rounded", "backdrop-blur"])}`
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="11" />
                  <line
                    x1="12"
                    y1="4"
                    x2="12"
                    y2="12"
                    style={{
                      transformOrigin: "center",
                      animation: "rotate-clock 1000ms linear infinite",
                    }}
                  />
                  <line
                    x1="12"
                    y1="8"
                    x2="12"
                    y2="12"
                    style={{
                      transformOrigin: "center",
                      animation: "rotate-clock 12000ms linear infinite",
                    }}
                  />
                </svg>
              </div>
            </div>
          </React.Fragment>
        )}
      {mountOverlay && !isCanvas && (
        <React.Fragment>
          <Script
            type="module"
            src={`${route}/static${UIVersion ? `/${UIVersion}` : ""}${VAL_APP_PATH}`}
            crossOrigin="anonymous"
          />
          {/* TODO: use portal to mount overlay */}
          <div id={VAL_OVERLAY_ID} ref={container}></div>
        </React.Fragment>
      )}
      {/**
       * In the studio's canvas the page reports itself instead of decorating
       * itself: where the elements Val tracks are, and which one was clicked.
       * The studio draws the rest.
       */}
      {mountOverlay && isCanvas && (
        <ValCanvasBridge
          draftMode={draftMode === true}
          isRefreshing={isRefreshing}
        />
      )}
      {/**
       * This iframe is used to enable or disable draft mode.
       * In Next.js applications, the draft mode must be switched on the API side.
       * We load the App.tsx with a query parameter, that tells us whether or not it is in draft mode.
       */}
      {mountOverlay && iframeSrc && (
        <iframe
          loading="eager"
          style={{
            top: 10,
            left: 10,
            position: "absolute",
            width: 1000,
            height: 1000,
            visibility: "hidden",
          }}
          src={iframeSrc}
          key={iframeSrc}
        />
      )}
    </ValOverlayProvider>
  );
};

function useConsoleLogEnableVal(showOverlay?: boolean) {
  React.useEffect(() => {
    if (
      process.env["NODE_ENV"] === "development" &&
      showOverlay === false &&
      !isValStudioPath(location.pathname)
    ) {
      console.warn(
        `
###########
###########
###########                           @@@@
###########                             @@
###########    @@      @@  @@@@@@ @     @@
###########     @@    @@  @@     @@     @@
###########     @@    @@ %@       @     @@
####  #####      @@  @@  .@      .@     @@
###    ####       @@@@    @@:   @@@.    @@
####  #####       @@@@      @@@@  =@@@@@@@@@
###########

This page is built with Val Build - the lightweight CMS where content is code.

Val is currently hidden.

To show Val, go to the following URL:
${window.location.origin}/api/val/enable?redirect_to=${encodeURIComponent(
          window.location.href,
        )}
        
You are seeing this message because you are in development mode.`,
      );
    }
  }, [showOverlay]);
}

const positionStyles = prefixStyles({
  "left-0": "left: 0;",
  "top-0": "top: 0;",
  "left-1/2": "left: 50%;",
  "top-1/2": "top: 50%;",
  "-translate-y-1/2": "transform: translateY(-50%);",
  "-translate-x-1/2": "transform: translateX(-50%);",
  "right-0": "right: 0;",
  "bottom-0": "bottom: 0;",
});

// This is a copy of the function from the ValMenu component.
function getPositionClassName(dropZone: string | null) {
  let className = cn(["fixed", "transform"]);
  if (dropZone === "val-menu-left-top") {
    className += ` ${cn(["left-0", "top-0"])}`;
  } else if (dropZone === "val-menu-left-center") {
    className += ` ${cn(["left-0", "top-1/2", "-translate-y-1/2"])}`;
  } else if (dropZone === "val-menu-left-bottom") {
    className += ` ${cn(["left-0", "bottom-0"])}`;
  } else if (dropZone === "val-menu-center-top") {
    className += ` ${cn(["left-1/2", "-translate-x-1/2", "top-0"])}`;
  } else if (dropZone === "val-menu-center-bottom") {
    className += ` ${cn(["left-1/2", "-translate-x-1/2", "bottom-0"])}`;
  } else if (dropZone === "val-menu-right-top") {
    className += ` ${cn(["right-0", "top-0"])}`;
  } else if (dropZone === "val-menu-right-center") {
    className += ` ${cn(["right-0", "top-1/2", "-translate-y-1/2"])}`;
  } else if (dropZone === "val-menu-right-bottom") {
    className += ` ${cn(["right-0", "bottom-0"])}`;
  } else {
    className += ` ${cn(["right-0", "bottom-0"])}`;
  }
  return className;
}

function isValStudioPath(pathname: string): boolean {
  return pathname.startsWith("/val");
}

// Same guards as the mountOverlay effect: suspending where the overlay can't
// mount would only ever stall into the waitForLoad timeout. Browser-only.
function shouldEnableVal(): boolean {
  if (location.search === "?message_onready=true") {
    return false;
  }
  if (isValStudioPath(location.pathname)) {
    return false;
  }
  return hasValEnableCookie(document.cookie);
}

// function ValIcon() {
//   return (
//     <svg
//       width="32"
//       height="32"
//       viewBox="0 0 105 149"
//       fill="none"
//       xmlns="http://www.w3.org/2000/svg"
//     >
//       <g filter="url(#filter0_d_14_634)">
//         <path
//           d="M21.4768 23.3474C21.4768 22.4628 22.1939 21.7457 23.0785 21.7457H77.1357C78.0203 21.7457 78.7374 22.4628 78.7374 23.3474V125.055C78.7374 125.94 78.0203 126.657 77.1357 126.657H23.0785C22.1939 126.657 21.4768 125.94 21.4768 125.055V23.3474Z"
//           fill="#38CD98"
//         />
//       </g>
//       <g filter="url(#filter1_i_14_634)">
//         <circle cx="49.9068" cy="104.233" r="9.61017" fill="#1E1F2A" />
//       </g>
//       <defs>
//         <filter
//           id="filter0_d_14_634"
//           x="0.0397091"
//           y="0.30863"
//           width="100.135"
//           height="147.785"
//           filterUnits="userSpaceOnUse"
//           colorInterpolationFilters="sRGB"
//         >
//           <feFlood floodOpacity="0" result="BackgroundImageFix" />
//           <feColorMatrix
//             in="SourceAlpha"
//             type="matrix"
//             values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
//             result="hardAlpha"
//           />
//           <feOffset />
//           <feGaussianBlur stdDeviation="10.7185" />
//           <feComposite in2="hardAlpha" operator="out" />
//           <feColorMatrix
//             type="matrix"
//             values="0 0 0 0 0.219608 0 0 0 0 0.803922 0 0 0 0 0.501961 0 0 0 0.3 0"
//           />
//           <feBlend
//             mode="normal"
//             in2="BackgroundImageFix"
//             result="effect1_dropShadow_14_634"
//           />
//           <feBlend
//             mode="normal"
//             in="SourceGraphic"
//             in2="effect1_dropShadow_14_634"
//             result="shape"
//           />
//         </filter>
//         <filter
//           id="filter1_i_14_634"
//           x="40.2966"
//           y="94.6229"
//           width="19.2205"
//           height="19.2204"
//           filterUnits="userSpaceOnUse"
//           colorInterpolationFilters="sRGB"
//         >
//           <feFlood floodOpacity="0" result="BackgroundImageFix" />
//           <feBlend
//             mode="normal"
//             in="SourceGraphic"
//             in2="BackgroundImageFix"
//             result="shape"
//           />
//           <feColorMatrix
//             in="SourceAlpha"
//             type="matrix"
//             values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
//             result="hardAlpha"
//           />
//           <feOffset />
//           <feGaussianBlur stdDeviation="2.40254" />
//           <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
//           <feColorMatrix
//             type="matrix"
//             values="0 0 0 0 0.219608 0 0 0 0 0.803922 0 0 0 0 0.501961 0 0 0 0.3 0"
//           />
//           <feBlend
//             mode="normal"
//             in2="shape"
//             result="effect1_innerShadow_14_634"
//           />
//         </filter>
//       </defs>
//     </svg>
//   );
// }
