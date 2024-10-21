"use client";

import { Internal, ModuleFilePath, ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_OVERLAY_ID } from "@valbuild/ui";
import { useRouter } from "next/navigation";
import Script from "next/script";
import React, { useEffect } from "react";
import { ValExternalStore, ValOverlayProvider } from "./ValOverlayContext";
import { SET_AUTO_TAG_JSX_ENABLED } from "@valbuild/react/stega";
import { createValClient } from "@valbuild/shared/internal";

/**
 * Shows the Overlay menu and updates the store which the client side useVal hook uses to display data.
 */
export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
}) => {
  // TODO: use config:
  const route = "/api/val";
  const client = React.useMemo(() => createValClient(route), [route]);

  // TODO: move below into react package
  const valStore = React.useMemo(() => new ValExternalStore(), []);
  const [showOverlay, setShowOverlay] = React.useState<boolean>();
  const [draftMode, setDraftMode] = React.useState<boolean | null>(null);
  const [spaReady, setSpaReady] = React.useState(false);
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const rerenderCounterRef = React.useRef(0);
  const [iframeSrc, setIframeSrc] = React.useState<string | null>(null);

  useConsoleLogEnableVal(showOverlay);
  React.useEffect(() => {
    if (location.search === "?message_onready=true") {
      console.warn("In message mode");
      return;
    }
    if (isValStudioPath(location.pathname)) {
      setShowOverlay(false);
      return;
    }
    setShowOverlay(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`),
    );
  }, []);

  React.useEffect(() => {
    if (!showOverlay) {
      return;
    }
    const interval = setInterval(() => {
      if (rerenderCounterRef.current > 0) {
        if (!props.disableRefresh) {
          rerenderCounterRef.current = 0;
          startTransition(() => {
            router.refresh();
          });
        }
      }
    }, 50);
    return () => {
      clearInterval(interval);
    };
  }, [showOverlay, props.disableRefresh]);

  React.useEffect(() => {
    if (!showOverlay) {
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
  }, [showOverlay, draftMode]);

  const pollDraftStatIdRef = React.useRef(0);
  useEffect(() => {
    // continous polling to check for updates:

    let timeout: NodeJS.Timeout;
    function pollCurrentDraftMode() {
      if (!showOverlay) {
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
          if (res.status !== 200) {
            console.error("Val: could not get draft mode status", res);
            return;
          }
          setDraftMode((prev) => {
            if (prev !== res.json.draftMode) {
              rerenderCounterRef.current++;
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
          timeout = setTimeout(
            pollCurrentDraftMode,
            iframeSrc === null ? 1000 : 100,
          );
        });
    }
    pollCurrentDraftMode();
    return () => {
      clearTimeout(timeout);
    };
  }, [showOverlay, iframeSrc]);

  React.useEffect(() => {
    if (!showOverlay) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("val-overlay-spa", {
        detail: {
          type: "draftMode",
          value: draftMode,
        },
      }),
    );
  }, [showOverlay, draftMode, spaReady]);

  React.useEffect(() => {
    if (!showOverlay) {
      SET_AUTO_TAG_JSX_ENABLED(false);
    } else {
      if (draftMode) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        const reactServerComponentRefreshListener = (event: Event) => {
          if (event instanceof CustomEvent) {
            if (event.detail?.type === "source-update") {
              const moduleFilePath = event.detail?.moduleFilePath;
              const source = event.detail?.source;
              if (typeof moduleFilePath === "string" && source !== undefined) {
                valStore.update(moduleFilePath as ModuleFilePath, source);
                if (!props.disableRefresh) {
                  rerenderCounterRef.current++;
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
  }, [showOverlay, draftMode, props.disableRefresh]);

  React.useEffect(() => {
    if (!showOverlay) {
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
  }, [showOverlay]);

  console.log({ showOverlay, draftMode, iframeSrc });

  return (
    <ValOverlayProvider draftMode={draftMode} store={valStore}>
      {props.children}
      {showOverlay && draftMode !== undefined && (
        <React.Fragment>
          <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
          {/* TODO: use portal to mount overlay */}
          <div id={VAL_OVERLAY_ID}></div>
        </React.Fragment>
      )}
      {/**
       * This iframe is used to enable or disable draft mode.
       * In Next.js applications, the draft mode must be switched on the API side.
       * We load the App.tsx with a query parameter, that tells us whether or not it is in draft mode.
       */}
      {iframeSrc && draftMode !== null && showOverlay && (
        <iframe
          style={{
            top: 0,
            left: 0,
            position: "absolute",
            width: 0,
            height: 0,
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

function isValStudioPath(pathname: string): boolean {
  return pathname.startsWith("/val/");
}
