/*
 * NOTE: no `"use client"` directive, on purpose.
 *
 * TanStack Start's default mode has no server/client component split — every
 * component is rendered on the server and then hydrated — so the directive
 * marks nothing, and Rollup warns about it ("module level directives cause
 * errors when bundled") in the build of every app that installs this package.
 * What keeps this file out of a server-only context is that it uses hooks.
 */

import { DEFAULT_CONTENT_HOST, ValConfig, Internal } from "@valbuild/core";
import {
  VAL_APP_PATH,
  VAL_OVERLAY_ID,
  VERSION as UIVersion,
} from "@valbuild/ui";
import { useRouter, useRouterState } from "@tanstack/react-router";
import React, { useEffect } from "react";
import { ValScript } from "./ValScript";
import { ValOverlayProvider } from "./ValOverlayContext";
import {
  SET_AUTO_TAG_JSX_ENABLED,
  isReactDevelopmentBuild,
  stegaLeakMessage,
  watchStegaLeaks,
} from "@valbuild/react/stega";
import {
  applyValEvent,
  createDraftStore,
  draftHolds,
  draftHoldsVersions,
  isDraft,
  startRefreshLoop,
  type RefreshLoop,
} from "@valbuild/react/internal";
import type { ValClient } from "@valbuild/shared/internal";
import { useConfigStorageSave } from "./useConfigStorageSave";
import { initSessionTheme } from "./initSessionTheme";
import { cn, prefixStyles, valPrefixedClass } from "./cssUtils";
import { hasValEnableCookie } from "./valEnableCookie";
import { floatDarkBg, floatLightBg } from "./fallbackColors";
import { isValCanvasFrame } from "@valbuild/shared/client";
import { ValCanvasBridge } from "./ValCanvasBridge";
import { isLiveSitePage, type ValDraft } from "./ValDraft";
import type { ValAnalytics } from "./ValAnalytics";
import { PlatformAnalytics, analyticsOfThisPage } from "./platformAnalytics";

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
 * Generous enough for a first compile in the dev server, which is the slowest case
 * that is not a fault.
 */
const DRAFT_HANDSHAKE_TIMEOUT_MS = 10_000;

export const ValTanStackProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
  /**
   * Opt in to Suspense gating for `useValStega` / `useValRouteStega`:
   * `<ValProvider config={config} suspend>`. Requires React 19 (`React.use`).
   *
   * When set, hooks suspend until draft data has loaded — but only when the
   * Val Enable cookie is present, which is detected client-side after
   * hydration. Without `draft`, SSR and hydration render the static committed
   * source (draft data arrives in the browser), and the gate then activates
   * inside a transition so that content stays visible while the draft loads.
   * With `draft`, SSR and hydration already render the draft the server read,
   * so there is nothing to wait for on the first render. Production
   * visitors without the cookie pay no cost, and layouts stay synchronous and
   * routes static.
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
  /**
   * The draft this page starts from, read on the server for this request:
   * `fetchValDraft()` from `initValContent`, called from a server function
   * in the site layout's loader.
   *
   * Without it the hooks have no draft until the overlay has loaded in the
   * browser, so the server renders the PUBLISHED site and the browser swaps
   * the draft in afterwards: every draft page load shows the old text first.
   * With it, the server renders the draft and the browser's first render
   * starts from the same sources, so both produce the same page and the
   * overlay takes over from there.
   *
   * Read once, when the provider mounts -- what the overlay sends after that
   * is newer. `null` (a visitor, or draft mode off) renders as before.
   */
  draft?: ValDraft | null;
  /**
   * Whether content analytics is on for this site, and the content version
   * the page is rendered from. Off unless this says so.
   *
   * It is a setting of the hosted PROJECT, not of the code: the owner turns it
   * on in the project's settings, and the platform hands it to the site as the
   * `VAL_ANALYTICS` secret. Leave this out and the provider reads that itself
   * (`platformAnalytics.tsx`), so switching it needs no code change and no
   * rebuild. Pass it -- `fetchValAnalytics()` from the generated
   * `val.server.ts` -- only to decide in the code instead; what is passed
   * wins. There is deliberately no `val.config.ts` option for it: a second
   * switch, in the code, is one the owner cannot see.
   *
   * Read once, when the provider mounts, as `draft` is: the loader runs only
   * on the server, so a client navigation hands this `undefined`, and the
   * page must not stop counting because of it. The flip side: a provider that
   * FIRST mounts during a client navigation -- a layout the visitor reached
   * from a route outside it -- has to be handed the value then too, or it
   * stays off until the next page load.
   *
   * A SELF-HOSTED site (Custom hosting) has no platform to hand it the
   * setting, so the provider reads nothing there: the layout's loader reads
   * `VAL_ANALYTICS` from the server's environment and passes it here, as
   * the showcase's `fetchValAnalytics()` does --
   * `{ enabled: process.env.VAL_ANALYTICS === "true" }`. Its Val server, in
   * http mode (`VAL_API_KEY`, `VAL_SECRET` and `VAL_PROJECT` set), hands
   * the beacons on to Val's ingest, which counts them only while analytics
   * is switched on for the project in Val's admin; while it is off the
   * script is told so (410) and stops sending.
   */
  analytics?: ValAnalytics | null;
  /**
   * This site is a Val demo: the Studio runs Val's API in the visitor's tab
   * (`<ValApp demo>`), so there is no server to ask whether draft mode is on.
   *
   * In the Studio's canvas the page is always the draft -- the Studio sends
   * it every edit over `postMessage` -- and everywhere else Val stays out of
   * the way entirely: no overlay, no cookie, no poll. Loaders are not re-run
   * on an edit, because a server reading content never sees the tab's edits;
   * read content with the client hooks (`useVal`) in a demo.
   *
   * Set it from the build, as for `ValApp`. Must be constant for the lifetime
   * of the page.
   */
  demo?: boolean;
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
   * The draft the page was rendered with, as it was at mount.
   *
   * A ref, not the prop: the server and the browser's first render must start
   * from the same thing, and a later prop -- the loader running again on a
   * client navigation, where it reads nothing -- must not reset a store the
   * overlay has been updating since.
   */
  const initialDraft = React.useRef(props.draft ?? null).current;
  /*
   * At a proposal's address the server sends its snapshot whether or not
   * draft mode is on, and one that is ONLY a snapshot (`draftMode: false`) is
   * not a draft: it must not turn draft mode on or say the draft is synced.
   */
  const hasDraft = isDraft(initialDraft);
  /*
   * As the page was rendered. A ref, not the prop, for the reason
   * `initialDraft` is one: a later render's prop is a client navigation's
   * loader, which reads nothing.
   *
   * A layout that passes nothing gets the project's setting from Val's
   * hosting itself (`platformAnalytics.tsx`): the server render reads what
   * the platform handed it and writes it into the page, and the browser
   * reads it back. So switching analytics on in the project's settings is
   * enough; the layout does not have to read it.
   */
  // Not in a demo: its `/api/val` is static files, with nowhere to count.
  const [platformAnalytics] = React.useState(() =>
    props.analytics === undefined && !props.demo ? analyticsOfThisPage() : null,
  );
  const [analyticsSetting] = React.useState(
    () => props.analytics ?? platformAnalytics,
  );
  const analytics = analyticsSetting?.enabled === true;
  const contentVersion = analyticsSetting?.contentVersion;
  const snapshot = initialDraft?.snapshot;
  const liveSitePage = isLiveSitePage(initialDraft);
  // TODO: move below into react package
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
  // hydration render. Two paths: without `draft` the server store is empty
  // (draft data arrives via browser CustomEvents only), so suspending there
  // would just stall into the waitForLoad timeout, and hydration must render
  // the static source so it matches the server HTML exactly; with `draft` the
  // store is seeded above on BOTH sides, so SSR and hydration already render
  // the draft and there is nothing to wait for. Keep the seed if this changes. Activated post-hydration
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
  // Known on the server when it read a draft: `fetchValDraft` only reads one
  // in draft mode. Otherwise unknown until `/draft/stat` answers.
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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
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
    if (props.demo) {
      // Only the canvas, and always as the draft: see `demo`.
      const canvas = isValCanvasFrame(location.search, readParentPathname());
      setIsCanvas(canvas);
      setMountOverlay(canvas);
      if (canvas) {
        setDraftMode(true);
      }
      return;
    }
    setIsCanvas(isValCanvasFrame(location.search, readParentPathname()));
    setMountOverlay(hasValEnableCookie(document.cookie));
  }, []);

  /**
   * The analytics script, for a visitor and nobody else.
   *
   * `mountOverlay === false` is "known not to be an editor": no Val enable
   * cookie, so no draft mode and no canvas. A page the server rendered from a
   * draft is an editor's too, whatever the enable cookie says -- the draft
   * mode cookie can outlive it. So is one at a proposal's address
   * (`ValDraft.atProposal`): its content is not published, and counting it
   * would credit the live site with it. Not "one with a snapshot": a site
   * serving a content version -- content published without a build -- gets
   * one too, and is the live site; asking that counted no visitor of any site
   * that had published content without a build. The Studio's own pages count nothing
   * either. Loaded with a dynamic import after hydration, so a site
   * with analytics off never downloads it, and one with it on downloads it
   * off the critical path. It imports nothing from core, shared or zod.
   */
  React.useEffect(() => {
    if (
      !analytics ||
      mountOverlay !== false ||
      !liveSitePage ||
      isCanvas ||
      isValStudioPath(location.pathname)
    ) {
      return;
    }
    // Where the page was hydrated, read now: the script loads later, and the
    // visitor may have moved on by then. See `landingPath`.
    const landingPath = location.pathname;
    let cancelled = false;
    let tracker: { stop(): void } | null = null;
    import("@valbuild/react/analytics")
      .then(({ startValAnalytics }) => {
        if (!cancelled) {
          tracker = startValAnalytics({
            endpoint: `${route}/analytics`,
            landingPath,
            contentVersion,
            // The route's pattern (`/posts/$postId`), never the pathname,
            // which can hold something about one visitor. A pathname no
            // route matches is not a page of the site.
            routeFor: (pathname) =>
              router.getMatchedRoutes(pathname)[2]?.fullPath ?? "(not found)",
          });
        }
      })
      .catch((error) => {
        Internal.log.warn("could not load analytics", error);
      });
    return () => {
      cancelled = true;
      tracker?.stop();
    };
  }, [
    analytics,
    contentVersion,
    mountOverlay,
    liveSitePage,
    isCanvas,
    route,
    router,
  ]);

  /**
   * The leak warning, in development, for the page a visitor gets with
   * analytics on: every edit tag that reached it somewhere `autoTagJSX` could
   * not take it out -- JSON-LD, the title, a `<meta>`, a share link -- named
   * in the console. Every visitor gets those tags after hydration, so a leak
   * not seen here ships.
   *
   * A visitor's page only, as the analytics script's gate has it: an
   * editor's is rendered from a draft, and content the server read for one
   * carries its tags in its text until the browser renders it again (see the
   * showcase's docs route) -- which no visitor ever gets, and which the
   * advice in the warning would not fix.
   */
  React.useEffect(() => {
    if (
      !isReactDevelopmentBuild() ||
      !analytics ||
      mountOverlay !== false ||
      isValStudioPath(location.pathname)
    ) {
      return;
    }
    return watchStegaLeaks((leak) => {
      Internal.log.warn(stegaLeakMessage(leak));
    });
  }, [analytics, mountOverlay]);

  React.useEffect(() => {
    // Activate the Suspense gate after hydration. Inside a transition so
    // already-visible (static) content stays on screen while useValStega
    // suspends — no fallback flash — and the swap to draft data commits as a
    // normal update instead of a hydration mismatch. Never deactivated:
    // components must not stop suspending across renders (the draft-mode-off
    // release valve lives in `overlaySource` instead).
    /*
     * Gated on `mountOverlay`, not on the cookie directly — the ORDER is the
     * point.
     *
     * `useValStega` suspends on `draftModeReady`, and the only thing that ever
     * resolves that is the `/draft/stat` poll below, which does not start until
     * `mountOverlay` is set. Activating the gate in the same effect flush that
     * sets `mountOverlay` means the tree can suspend before that state has
     * committed, and then it never does: React was left re-rendering a
     * suspended tree in which `mountOverlay` is forever `undefined`, so the
     * poll never ran, so the promise never resolved. The page hydrated and then
     * simply stopped — no overlay, no draft content, no error.
     *
     * Reading `mountOverlay` instead makes the dependency explicit: the poll is
     * running by the time anything is allowed to wait on it.
     */
    if (props.suspend && mountOverlay) {
      startTransition(() => {
        setSuspendActive(true);
      });
    }
  }, [props.suspend, mountOverlay]);

  /**
   * Re-run the loaders when the server has the editor's changes: once per
   * version the Studio says it has confirmed (`startRefreshLoop`), never on
   * a timer and never when an edit merely arrives -- arrived, it raced the
   * write and came back without the edit.
   */
  React.useEffect(() => {
    // A demo's loaders read a server that never sees the tab's edits, so
    // re-running them would only fetch the published content again.
    if (!mountOverlay || props.disableRefresh || props.demo) {
      return;
    }
    const loop = startRefreshLoop({
      refresh: () => {
        let done: Promise<void> | undefined;
        startTransition(() => {
          /*
           * Re-run the loaders of every match, then re-render.
           *
           * TanStack's equivalent of `router.refresh()`. `invalidate()` marks
           * the current matches stale and re-runs their loaders — which is
           * where a TanStack Start app reads Val content on the server — so
           * this is the round trip that brings an edit across. It resolves
           * when the loaders have settled, which is what keeps `isRefreshing`
           * honest, and what lets the loop hold a newer version until this
           * one is in.
           */
          done = router.invalidate();
        });
        return done;
      },
    });
    refreshLoopRef.current = loop;
    return () => {
      refreshLoopRef.current = null;
      loop.stop();
    };
  }, [mountOverlay, props.disableRefresh, props.demo]);

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
      // A demo has no server to ask: draft mode is on in its canvas, and
      // nothing is mounted anywhere else.
      if (!mountOverlay || props.demo) {
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
            // What the loaders read moved with it.
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
  }, [mountOverlay, iframeSrc, props.demo]);

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

  React.useEffect(() => {
    if (!mountOverlay) {
      // A visitor: only analytics tags content, and only after hydration
      // (`useEncodesEditTags`), so this cannot reach a component still
      // hydrating either.
      SET_AUTO_TAG_JSX_ENABLED(analytics);
    } else {
      if (analytics) {
        SET_AUTO_TAG_JSX_ENABLED(true);
      }
      if (draftMode) {
        // Safe for a page rendered from a server draft too: what a component
        // renders while it hydrates has no edit tags to turn into attributes
        // (`useEncodesEditTags`), so this cannot reach one still hydrating.
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
  }, [mountOverlay, draftMode, analytics]);

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
      serverDraft={hasDraft}
      analytics={analytics}
      snapshot={snapshot}
      suspend={suspendActive}
      store={valStore}
    >
      {props.children}
      {platformAnalytics !== null && (
        <PlatformAnalytics value={platformAnalytics} />
      )}
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
          <ValScript
            src={`${route}/static${UIVersion ? `/${UIVersion}` : ""}${VAL_APP_PATH}`}
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
      // Not `process.env.NODE_ENV`: the dev server does not define it in
      // the browser, so the banner never showed. React's development build
      // is what `vite dev` serves.
      isReactDevelopmentBuild() &&
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
