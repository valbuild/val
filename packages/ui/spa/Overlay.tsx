"use client";
import { ErrorBoundary } from "react-error-boundary";
import { createValClient } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH } from "../src/constants";
import { fallbackRender } from "./fallbackRender";
import { ValOverlay } from "./components/ValOverlay";
import { ValRouter } from "./components/ValRouter";
import { useEffect, useState } from "react";
import { ValProvider } from "./components/ValProvider";
import { Fonts } from "./Fonts";
import { DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { useRemoteConfigReceiver } from "./hooks/useRemoteConfigReceiver";

function Overlay() {
  const config = useRemoteConfigReceiver();
  const host = "/api/val";
  const client = createValClient("/api/val", {
    ...config,
    contentHostUrl: DEFAULT_CONTENT_HOST,
  });

  const [draftMode, setDraftMode] = useState(false);
  const [draftModeLoading, setDraftModeLoading] = useState(false);
  useEffect(() => {
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (
          event?.detail.type === "draftMode" &&
          typeof event?.detail.value === "boolean"
        ) {
          setDraftMode(event.detail.value);
        } else if (
          event.detail.type === "draftModeLoading" &&
          typeof event.detail.value === "boolean"
        ) {
          setDraftModeLoading(event.detail.value);
        } else {
          console.error(
            "Val: invalid event detail (val-overlay-spa)",
            event.detail,
          );
        }
      } else {
        console.error("Val: invalid event (val-overlay-spa)", event);
      }
    };
    window.addEventListener("val-overlay-spa", listener);
    window.dispatchEvent(
      new CustomEvent("val-overlay-provider", {
        detail: {
          type: "spa-ready",
        },
      }),
    );
    return () => {
      window.removeEventListener("val-overlay-spa", listener);
    };
  }, []);
  return (
    <>
      <Fonts />
      <ShadowRoot>
        <style>{`
          #val-overlay-container {
            visibility: hidden;
          }
        `}</style>
        <link rel="stylesheet" href={`${host}/static${VAL_CSS_PATH}`} />
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ValProvider
            client={client}
            dispatchValEvents={draftMode}
            config={config}
          >
            <ValRouter overlay>
              <ValOverlay
                draftMode={draftMode}
                draftModeLoading={draftModeLoading}
                setDraftMode={(value: boolean) => {
                  const event = new CustomEvent("val-overlay-provider", {
                    detail: {
                      type: "draftMode",
                      value,
                    },
                  });
                  window.dispatchEvent(event);
                }}
                disableOverlay={() => {
                  location.href = `${window.location.origin}/api/val/disable?redirect_to=${encodeURIComponent(
                    window.location.href,
                  )}`;
                }}
              />
            </ValRouter>
          </ValProvider>
        </ErrorBoundary>
      </ShadowRoot>
    </>
  );
}

export default Overlay;
