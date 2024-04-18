"use client";
import { ValApi } from "@valbuild/core";
import { ValContentView } from "./components/ValContentView";
import { ErrorBoundary } from "react-error-boundary";
import { ValStore } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";
import { useMemo } from "react";
import { ValRouter } from "./components/ValRouter";

function App() {
  const { api, store } = useMemo(() => {
    const api = new ValApi("/api/val");
    const store = new ValStore(api);
    return { api, store };
  }, []);

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
      <ValRouter>
        <ValContentView api={api} store={store} />
      </ValRouter>
    </ErrorBoundary>
  );
}

export default App;
