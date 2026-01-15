"use client";
import { ValStudio } from "./components/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { fallbackRender } from "./fallbackRender";
import { useMemo, useState } from "react";
import { createValClient } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH, VERSION } from "../src";
import { Fonts } from "./Fonts";
import { DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { useConfig } from "./hooks/useConfig";

function App() {
  const config = useConfig();
  const host = "/api/val"; // TODO: make configurable
  const { client } = useMemo(() => {
    const client = createValClient(host, {
      ...config,
      contentHostUrl: DEFAULT_CONTENT_HOST,
    });
    return { client };
  }, [host, config]);
  const [cssLoaded, setCssLoaded] = useState(false);
  return (
    <>
      <Fonts />
      <ShadowRoot>
        <link
          rel="stylesheet"
          href={`${host}/static${VERSION ? `/${VERSION}` : ""}${VAL_CSS_PATH}`}
          onLoad={() => {
            // send an event that css is loaded:
            window.dispatchEvent(
              new CustomEvent("val-css-loaded", {
                detail: {
                  type: "val-css-loaded",
                },
              }),
            );
            setCssLoaded(true);
          }}
        />
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ValStudio client={client} config={config} cssLoaded={cssLoaded} />
        </ErrorBoundary>
      </ShadowRoot>
    </>
  );
}

export default App;
