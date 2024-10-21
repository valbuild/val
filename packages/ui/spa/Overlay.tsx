"use client";
import { ErrorBoundary } from "react-error-boundary";
import { createValClient } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH } from "../src/constants";
import { fallbackRender } from "./fallbackRender";
import { ValOverlay } from "./components/overlay/ValOverlay";
import { ValRouter } from "./components/ValRouter";
import { useEffect, useState } from "react";
import { ValProvider } from "./ng/ValProvider";

function Overlay() {
  const host = "/api/val";
  const client = createValClient(host);

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
    <ShadowRoot>
      {/* TODO: */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;1,100;1,300;1,400;1,500;1,700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
        rel="stylesheet"
      />
      <style>{`
          #val-overlay-container {
            visibility: hidden;
          }
        `}</style>
      <link
        rel="stylesheet"
        href={`${host || "/api/val"}/static${VAL_CSS_PATH}`}
      />
      <ErrorBoundary fallbackRender={fallbackRender}>
        <ValRouter overlay>
          <ValProvider client={client} dispatchValEvents={draftMode}>
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
          </ValProvider>
        </ValRouter>
      </ErrorBoundary>
    </ShadowRoot>
  );
}

export default Overlay;
