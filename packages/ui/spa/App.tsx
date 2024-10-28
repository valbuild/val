"use client";
import { ValStudio } from "./components/studio/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { ValCache } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";
import { useMemo } from "react";
import { ValRouter } from "./components/ValRouter";
import { createValClient } from "@valbuild/shared/internal";
import { ShadowRoot } from "./components/ShadowRoot";
import { VAL_CSS_PATH } from "../src";
import { Fonts } from "./Fonts";

function App() {
  const { client, cache } = useMemo(() => {
    const client = createValClient("/api/val");
    const cache = new ValCache(client);
    return { client, cache };
  }, []);

  const host = "/api/val";
  return (
    <>
      <Fonts />
      <ShadowRoot>
        <link rel="stylesheet" href={`${host}/static${VAL_CSS_PATH}`} />
        <ErrorBoundary fallbackRender={fallbackRender}>
          <ValRouter>
            <ValStudio client={client} cache={cache} />
          </ValRouter>
        </ErrorBoundary>
      </ShadowRoot>
    </>
  );
}

export default App;
