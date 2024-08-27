"use client";
import { ValStudio } from "./components/studio/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { ValStore } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";
import { useMemo } from "react";
import { ValRouter } from "./components/ValRouter";
import { createValClient } from "@valbuild/shared/internal";

function App() {
  const { client, store } = useMemo(() => {
    const client = createValClient("/api/val");
    const store = new ValStore(client);
    return { client: client, store };
  }, []);

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
      <ValRouter>
        <ValStudio client={client} store={store} />
      </ValRouter>
    </ErrorBoundary>
  );
}

export default App;
