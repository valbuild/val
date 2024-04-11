"use client";
import { ValApi } from "@valbuild/core";
import { ValFullscreen } from "./components/ValFullscreen";
import { ErrorBoundary } from "react-error-boundary";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ValStore } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";

/*
 * This is used to render statically on the API. We added this while investigating navigation issues in NextJS so we could test things out. It might be useful for other stuff though.
 */
function AppStatic() {
  const api = new ValApi("/api/val");
  const store = new ValStore(api);
  const router = createBrowserRouter(
    [
      {
        path: "/*",
        element: (
          <ErrorBoundary fallbackRender={fallbackRender}>
            <ValFullscreen api={api} store={store} />
          </ErrorBoundary>
        ),
      },
    ],
    {
      basename: "/api/val/static",
    }
  );

  return <RouterProvider router={router} />;
}

export default AppStatic;
