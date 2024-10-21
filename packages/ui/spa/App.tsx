"use client";
import { ValStudio } from "./components/studio/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { ValCache } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";
import { useEffect, useMemo } from "react";
import { ValRouter } from "./components/ValRouter";
import { createValClient } from "@valbuild/shared/internal";

function App() {
  const { client, cache } = useMemo(() => {
    const client = createValClient("/api/val");
    const cache = new ValCache(client);
    return { client, cache };
  }, []);
  useEffect(() => {
    if (location.search === "?message_onready=true") {
      const interval = setInterval(() => {
        window.parent.postMessage(
          {
            type: "val-ready",
          },
          "*",
        );
      });
      return () => {
        clearInterval(interval);
      };
    }
  }, []);

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
      <ValRouter>
        <ValStudio client={client} cache={cache} />
      </ValRouter>
    </ErrorBoundary>
  );
}

export default App;
