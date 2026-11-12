"use client";

import { DEFAULT_CONTENT_HOST, ValConfig, Internal } from "@valbuild/core";
import {
  VAL_APP_PATH,
  VAL_OVERLAY_ID,
  VERSION as UIVersion,
} from "@valbuild/ui";
import { useRouter, usePathname } from "next/navigation";
import Script from "next/script";
import React, { useEffect } from "react";
import { ValOverlayProvider } from "./ValOverlayContext";
import { SET_AUTO_TAG_JSX_ENABLED } from "@valbuild/react/stega";
import {
  applyValEvent,
  createDraftStore,
  draftHolds,
  draftHoldsVersions,
  isDraft,
  dispatchCodeChanged,
  startRefreshLoop,
  windowCodeChangedReporter,
  type RefreshLoop,
  type ValDraft,
} from "@valbuild/react/internal";
import type { ValClient } from "@valbuild/shared/internal";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { initSessionTheme } from "./initSessionTheme";
import { cn, prefixStyles, valPrefixedClass } from "./cssUtils";
import { hasValEnableCookie } from "./valEnableCookie";
import { floatDarkBg, floatLightBg } from "./fallbackColors";
import {
  installPageLogInCanvasFrame,
  isValCanvasFrame,
} from "@valbuild/shared/client";
import { ValCanvasBridge } from "./ValCanvasBridge";

/*
 * What goes wrong on the page, kept from now on when this document is in the
 * Studio's canvas: the assistant's `read_page_log` (`pageLog.ts`). Here, when
 * the module is evaluated, rather than when the bridge mounts, because that
 * is after hydration -- and a hydration error is one of the things it is for.
 * Anywhere else (a visitor's page, the server) this does nothing.
 */
installPageLogInCanvasFrame();

/**
 * Shows the Overlay menu and updates the store which the client side useVal hook uses to display data.
 */
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
   * "Previewing unpublished pages" for what to tell users. With `draft`, it
   * does: the server renders the draft it read, so the render that decides
   * already has the route.
   */
  suspend?: boolean;
  /**
   * The draft this page starts from, read on the server for this request:
   * the source of every module the editor's draft changes (`ValDraft` in
   * `@valbuild/react/stega`, the shape `@valbuild/tanstack`'s `draft` takes).
   * Optional, and additive: without it the provider behaves exactly as it
   * did.
   *
   * Without it the hooks of a client component have no draft until the
   * overlay has loaded in the browser, so the server renders, and the
   * browser hydrates, the PUBLISHED content and the draft comes in
   * afterwards: every draft page load shows the old text first, and a route
   * that exists only in an unpublished patch is `null` on the render that
   * decides -- the one a page turns into `notFound()`. With it, the store is
   * seeded on the server and in the browser alike, so the server renders the
   * draft and the browser's first render agrees with it; draft mode starts
   * known, and nothing waits for the Studio. The edit tags are left out of
   * what a component renders on the server and while it hydrates, and put in
   * by the render right after.
   *
   * Read once, when the provider mounts: a later prop does not reset a store
   * the overlay has been updating since. `null` (a visitor, or draft mode
   * off) renders as before. Pass it only to an editor's request: a page that
   * reads a draft is rendered per request.
   */
  draft?: ValDraft | null;
}) => {
  // TODO: use config:
  const route = "/api/val";
  /**
   * Loaded on first use, never at import time.
   *
   * `createValClient` validates every request and response against the zod
   * schemas in `@valbuild/shared/internal`'s `ApiRoutes`, and preconstruct
   * publishes that entrypoint as one module - so importing it statically put
   * ~113 KB of zod in the bundle of every page of every Val site. The only
   * caller is the draft-mode poll below, which returns early unless
   * `mountOverlay` is set, so a visitor without the Val Enable cookie never
   * triggers this import and never downloads that chunk.
   */
  const clientRef = React.useRef<ValClient | null>(null);
  const configRef = React.useRef(props.config);
  configRef.current = props.config;
  const getClient = React.useCallback(async (): Promise<ValClient> => {
    if (!clientRef.current) {
      const { createValClient } = await import("@valbuild/shared/internal");
      clientRef.current = createValClient(route, {
        ...configRef.current,
        contentHostUrl: DEFAULT_CONTENT_HOST,
      });
    }
    return clientRef.current;
  }, [route]);

  /**
   * The draft the page was rendered with, as it was at mount. A ref, not the
   * prop: the server and the browser's first render must start from the
   * same thing, and a later prop must not reset a store the overlay has been
   * updating since. One that is not a draft (`draftMode: false`) is not one.
   */
  const initialDraft = React.useRef(props.draft ?? null).current;
  const hasDraft = isDraft(initialDraft);
  // TODO: move below into react package
  /*
   * Told by the hooks whether each relayed module was made with this page's
   * schema, and says so to the overlay (`codeChangedReporter`). One for the
   * life of the provider, so the hooks' env is not made again every render.
   * None on the server: nothing there is relayed.
   */
  const [codeChanged] = React.useState(() =>
    typeof window === "undefined" ? undefined : windowCodeChangedReporter(),
  );
  const valStore = React.useMemo(
    () => createDraftStore(initialDraft),
    [initialDraft],
  );
  /**
   * What this page reports to the Studio when it connects: the modules it
   * was rendered with a draft of (`draftHolds`). The Studio sends each of
   * them in its catch-up, so a draft that stopped being the draft before the
   * Studio was there -- discarded, published -- does not stay on the page.
   */
  const holds = React.useMemo(() => draftHolds(initialDraft), [initialDraft]);
  // And the version of each, where the draft says: one the Studio would send
  // at the same version is the same content, and is not sent again.
  const holdsVersions = React.useMemo(
    () => draftHoldsVersions(initialDraft),
    [initialDraft],
  );
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
  // A server-read draft is everything there is: a module missing from it has
  // no changes, so there is nothing more to wait for.
  const [draftSourcesSynced, setDraftSourcesSynced] = React.useState(hasDraft);
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
  // Known on the server when it read a draft: a draft is only read in draft
  // mode. Otherwise unknown until `/draft/stat` answers.
  const [draftMode, setDraftModeState] = React.useState<boolean | null>(
    hasDraft ? true : null,
  );
  /**
   * `draftMode` as last set: what an answer from `/draft/stat` is compared
   * with, to know whether it MOVED draft mode and so whether to refresh.
   *
   * Compared here, and the refresh sent after `setDraftMode`, rather than in
   * a `setDraftMode` updater: React may call an updater twice (StrictMode)
   * or during a render, and a refresh is a side effect -- run twice it is
   * two refreshes, and run in a render it is a `startTransition` while
   * rendering, which React refuses with a warning.
   */
  const draftModeRef = React.useRef<boolean | null>(draftMode);
  /** Set draft mode; `true` when that moved it. */
  const setDraftMode = (next: boolean): boolean => {
    const moved = draftModeRef.current !== next;
    draftModeRef.current = next;
    setDraftModeState(next);
    return moved;
  };
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
   * The page's refresh loop, while the overlay is up: the `val-event`
   * listener tells it what the Studio says. A ref, so the listener's effect
   * is not rebuilt with it.
   */
  const refreshLoopRef = React.useRef<RefreshLoop | null>(null);
  const [iframeSrc, setIframeSrc] = React.useState<string | null>(null);
  const pathname = usePathname();
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
      Internal.log.debug("verifying draft mode...");
      return;
    }
    if (isValStudioPath(location.pathname)) {
      setMountOverlay(false);
      return;
    }
    setIsCanvas(isValCanvasFrame(location.search, readParentPathname()));
    setMountOverlay(hasValEnableCookie(document.cookie));
  }, []);

  React.useEffect(() => {
    // Activate the Suspense gate after hydration. Inside a transition so
    // already-visible (static) content stays on screen while useValStega
    // suspends — no fallback flash — and the swap to draft data commits as a
    // normal update instead of a hydration mismatch. Never deactivated:
    // components must not stop suspending across renders (the draft-mode-off
    // release valve lives in `overlaySource` instead).
    if (props.suspend && shouldEnableVal()) {
      startTransition(() => {
        setSuspendActive(true);
      });
    }
  }, [props.suspend]);

  /**
   * Re-render the server tree when the server has the editor's changes: once
   * per version the Studio says it has confirmed (`startRefreshLoop`), never
   * on a timer and never when an edit merely arrives -- arrived, it raced
   * the write, and the server components came back without the edit.
   *
   * `router.refresh()` does not say when it is done, so a version confirmed
   * while one is on its way is a refresh of its own; the transition is what
   * the canvas shows as busy (`isRefreshing`).
   */
  React.useEffect(() => {
    if (!mountOverlay || props.disableRefresh) {
      return;
    }
    const loop = startRefreshLoop({
      refresh: () => {
        startTransition(() => {
          router.refresh();
        });
      },
    });
    refreshLoopRef.current = loop;
    return () => {
      refreshLoopRef.current = null;
      loop.stop();
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
          Internal.log.error(
            "invalid event detail (val-overlay-provider)",
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
          Internal.log.error(
            "invalid event detail (val-overlay-provider)",
            event.detail,
          );
        }
      } else {
        Internal.log.error("invalid event (val-overlay-provider)", event);
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
      getClient()
        .then((client) => client("/draft/stat", "GET", {}))
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
            Internal.log.error("could not get draft mode status", res);
            return;
          }
          if (setDraftMode(res.json.draftMode)) {
            // What the server components read moved with it.
            refreshLoopRef.current?.refresh();
          }
        })
        .catch((err) => {
          Internal.log.error("could not get draft mode status", err);
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
            Internal.log.warn(
              "draft mode did not confirm in time. Falling back to the " +
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
          holds,
          holdsVersions,
        },
      }),
    );
  }, [mountOverlay, draftMode, spaReady, holds, holdsVersions]);

  // What the hooks could not read for its schema, said again once the
  // overlay listens: an announcement made before it loaded reached no one.
  React.useEffect(() => {
    if (!mountOverlay || !spaReady || codeChanged === undefined) return;
    const modules = codeChanged.modules();
    if (modules.length > 0) dispatchCodeChanged(modules);
  }, [mountOverlay, spaReady, codeChanged]);

  React.useEffect(() => {
    if (!mountOverlay) {
      SET_AUTO_TAG_JSX_ENABLED(false);
    } else {
      if (draftMode) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        const reactServerComponentRefreshListener = (event: Event) => {
          if (!(event instanceof CustomEvent)) {
            Internal.log.error("invalid custom event (val-event)", event);
            return;
          }
          const outcome = applyValEvent(valStore, event.detail);
          if (outcome.type === "synced") {
            setDraftSourcesSynced(true);
            return;
          }
          if (outcome.type === "confirmed") {
            refreshLoopRef.current?.confirmed(outcome.seq);
            return;
          }
          if (outcome.type === "invalid") {
            Internal.log.error(
              "invalid custom event details (val-event)",
              outcome.detail,
            );
            return;
          }
          /**
           * Not a refresh: the server may not have it yet. Only, before the
           * Studio's first `confirmed`, that this page's render is behind
           * what the Studio holds (`startRefreshLoop`). A module re-sent that
           * the page already shows does not count.
           */
          if (outcome.changed) {
            refreshLoopRef.current?.changed();
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
  }, [mountOverlay, draftMode]);

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
      schemaChecked={codeChanged?.schemaChecked}
      draftMode={draftMode}
      draftModeReady={draftModeReady.current?.promise}
      draftSourcesSynced={draftSourcesSynced}
      serverDraft={hasDraft}
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
          holds={holds}
          holdsVersions={holdsVersions}
          codeChanged={codeChanged?.modules}
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
      Internal.log.warn(
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

/**
 * The Studio is `/val` and what is below it -- not every route that starts
 * with the letters, which would leave `/values` without its overlay.
 */
function isValStudioPath(pathname: string): boolean {
  return pathname === "/val" || pathname.startsWith("/val/");
}

/**
 * The path of the window framing this document, or `null`.
 *
 * `null` for a top-level document, and for a parent on another origin: reading
 * a cross-origin `location` throws, and a page on another origin is not the
 * studio, whose canvas is always the same app. See `isValCanvasFrame`.
 */
function readParentPathname(): string | null {
  try {
    if (window.parent === window) {
      return null;
    }
    return window.parent.location.pathname;
  } catch {
    return null;
  }
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
