"use client";
import { ValApi } from "@valbuild/core";
import { ErrorBoundary } from "react-error-boundary";
import { ValStore } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH } from "../src/constants";
import { fallbackRender } from "./fallbackRender";
import { ValOverlay } from "./components/ValOverlay";

function Overlay() {
  const host = "/api/val";
  const api = new ValApi(host);
  const store = new ValStore(api); // TODO: replace this

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
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
        <link
          rel="stylesheet"
          href={`${host || "/api/val"}/static${VAL_CSS_PATH}`}
        />
        <ValOverlay
          api={api}
          store={store}
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
      </ShadowRoot>
    </ErrorBoundary>
  );
}

export default Overlay;
