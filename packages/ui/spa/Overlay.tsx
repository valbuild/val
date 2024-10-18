"use client";
import { ErrorBoundary } from "react-error-boundary";
import { createValClient, ValCache } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH } from "../src/constants";
import { fallbackRender } from "./fallbackRender";
import { ValOverlay } from "./components/overlay/ValOverlay";
import { ValRouter } from "./components/ValRouter";
import { useEffect, useState } from "react";
import { ValConfigProvider } from "./components/ValConfigContext";

function Overlay() {
  const host = "/api/val";
  const client = createValClient(host);

  const [config, setConfig] = useState({});

  useEffect(() => {
    const handleConfigEvent = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (event.detail.type === "config") {
          setConfig(event.detail.config);
        }
      }
    };

    window.addEventListener("val-config-event", handleConfigEvent);

    // Send init event here to let the next app know that the overlay is ready for events
    const event = new CustomEvent("val-overlay-ready");
    window.dispatchEvent(event);

    return () => {
      window.removeEventListener("val-config-event", handleConfigEvent);
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
        <ValConfigProvider config={config}>
          <ValRouter overlay>
            <ValOverlay
              client={client}
              onSubmit={() => {
                const event = new CustomEvent("val-event", {
                  detail: {
                    type: "overlay-submit",
                    refreshRequired: true,
                  },
                });
                window.dispatchEvent(event);
              }}
            />
          </ValRouter>
        </ValConfigProvider>
      </ErrorBoundary>
    </ShadowRoot>
  );
}

export default Overlay;
