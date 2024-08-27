"use client";
import { ValStudio } from "./components/studio/ValStudio";
import { ErrorBoundary } from "react-error-boundary";
import { createValClient, ValStore } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";
import { ValRouter } from "./components/ValRouter";

/*
 * This is used to render statically on the API. We added this while investigating navigation issues in NextJS so we could test things out. It might be useful for other stuff though.
 */
function AppStatic() {
  const client = createValClient("/api/val");
  const store = new ValStore(client);

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
      <ValRouter>
        <ValStudio client={client} store={store} />
      </ValRouter>
    </ErrorBoundary>
  );
}

export default AppStatic;
