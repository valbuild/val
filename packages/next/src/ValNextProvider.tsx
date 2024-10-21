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
  const [, startTransition] = React.useTransition();
  const router = useRouter();
  const [showOverlay, setShowOverlay] = React.useState<boolean>();
  const [draftMode, setDraftMode] = React.useState(true);
  const [spaReady, setSpaReady] = React.useState(false);

  React.useEffect(() => {
    setShowOverlay(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`),
    );
    try {
      setDraftMode(localStorage.getItem("val_draft_mode") === "true");
    } catch (e) {
      console.error(
        "Val: could not ready default draft mode from local storage",
        e,
      );
    }
  }, []);
  React.useEffect(() => {
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
          typeof event.detail.value === "boolean"
        ) {
          setDraftMode(event.detail.value);
          localStorage.setItem("val_draft_mode", event.detail.value.toString());
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
  }, []);
  React.useEffect(() => {
    if (spaReady) {
      window.dispatchEvent(
        new CustomEvent("val-overlay-spa", {
          detail: {
            type: "draftMode",
            value: draftMode,
          },
        }),
      );
    }
  }, [draftMode, spaReady]);
  React.useEffect(() => {}, [draftMode, router]);

  const rerenderCounterRef = React.useRef(0);
  React.useEffect(() => {
    if (showOverlay) {
      const interval = setInterval(() => {
        if (rerenderCounterRef.current > 0) {
          if (!props.disableRefresh) {
            startTransition(() => {
              rerenderCounterRef.current = 0;
              router.refresh();
            });
          }
        }
      }, 50);
      return () => {
        clearInterval(interval);
      };
    }
  }, [showOverlay]);

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

  const [iframeSrc, setIframeSrc] = React.useState<string | null>(null);

  const [serverSideDraftModeEnabled, setServerSideDraftModeEnabled] =
    React.useState(false);

  const draftStatIdRef = React.useRef(0);
  useEffect(() => {
    if (!showOverlay) {
      setIframeSrc(null);
    }
    const draftStatId = ++draftStatIdRef.current;
    client("/draft/stat", "GET", {})
      .then((res) => {
        if (draftStatIdRef.current !== draftStatId) {
          return;
        }
        if (res.status !== 200) {
          console.error("Val: could not get draft mode status", res);
          return;
        }
        if (draftMode === res.json.draftMode) {
          return;
        }
        if (draftMode) {
          setServerSideDraftModeEnabled(true);
          setIframeSrc(
            `${route}/draft/enable?redirect_to=${encodeURIComponent(
              window.location.origin + "/val?message_onready=true",
            )}`,
          );
        } else {
          setServerSideDraftModeEnabled(true);
          setIframeSrc(
            `${route}/draft/disable?redirect_to=${encodeURIComponent(
              window.location.origin + "/val?message_onready=true",
            )}`,
          );
        }
      })
      .catch((err) => {
        console.error("Val: could not get draft mode status", err);
      });
    return () => {
      draftStatIdRef.current--;
    };
  }, [draftMode]);

  React.useEffect(() => {
    if (serverSideDraftModeEnabled) {
      const listener = (event: MessageEvent) => {
        if (
          event.origin === location.origin &&
          event.data.type === "val-ready"
        ) {
          if (!props.disableRefresh) {
            startTransition(() => {
              router.refresh();
            });
          }
          setIframeSrc(null);
          setServerSideDraftModeEnabled(false);
        }
      };
      window.addEventListener("message", listener);
      return () => {
        window.removeEventListener("message", listener);
      };
    }
  }, [serverSideDraftModeEnabled]);

  React.useEffect(() => {
    if (process.env["NODE_ENV"] === "development" && showOverlay === false) {
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

  console.log(iframeSrc);
  return (
    <ValOverlayProvider draftMode={draftMode} store={valStore}>
      {props.children}
      {showOverlay && (
        <React.Fragment>
          <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
          {/* TODO: use portal to mount overlay */}
          <div id={VAL_OVERLAY_ID}></div>
        </React.Fragment>
      )}
      {iframeSrc && showOverlay && (
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
