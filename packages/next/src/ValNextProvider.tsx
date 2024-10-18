"use client";

import { Internal, ModuleFilePath, ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_OVERLAY_ID } from "@valbuild/ui";
import { useRouter } from "next/navigation";
import Script from "next/script";
import React, { useEffect } from "react";
import { ValExternalStore, ValOverlayProvider } from "./ValOverlayContext";
import { SET_AUTO_TAG_JSX_ENABLED } from "@valbuild/react/stega";

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

  // TODO: move below into react package
  const valStore = React.useMemo(() => new ValExternalStore(), []);
  const [, startTransition] = React.useTransition();
  const router = useRouter();
  const [showOverlay, setShowOverlay] = React.useState(false);
  const [draftMode, setDraftMode] = React.useState(false);
  const [spaReady, setSpaReady] = React.useState(false);

  React.useEffect(() => {
    setShowOverlay(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`),
    );
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
  useEffect(() => {
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

  React.useEffect(() => {}, [draftMode]);

  React.useEffect(() => {
    if (!showOverlay) {
      SET_AUTO_TAG_JSX_ENABLED(false);
      if (process.env["NODE_ENV"] === "development" && !showOverlay) {
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
                  startTransition(() => {
                    router.refresh();
                  });
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
    </ValOverlayProvider>
  );
};
