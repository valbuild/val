"use client";
import { ValApi } from "@valbuild/core";
import { ValContentView } from "./components/ValContentView";
import { ErrorBoundary } from "react-error-boundary";
import { ValStore } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";
import { ValRouter } from "./components/ValRouter";

/*
 * This is used to render statically on the API. We added this while investigating navigation issues in NextJS so we could test things out. It might be useful for other stuff though.
 */
function AppStatic() {
  const api = new ValApi("/api/val");
  const store = new ValStore(api);

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
      <ValRouter>
        <ValContentView api={api} store={store} />
      </ValRouter>
    </ErrorBoundary>
  );
}

export default AppStatic;
