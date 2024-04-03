"use client";
import { ValApi } from "@valbuild/core";
import { ValFullscreen } from "./components/ValFullscreen";
import { ErrorBoundary } from "react-error-boundary";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ValStore } from "@valbuild/shared/internal";
import { fallbackRender } from "./fallbackRender";

function App() {
  const api = new ValApi("/api/val");
  const router = createBrowserRouter(
    [
      {
        path: "/*",
        element: (
          <ErrorBoundary fallbackRender={fallbackRender}>
            <ValFullscreen api={api} store={new ValStore(api)} />
          </ErrorBoundary>
        ),
      },
    ],
    {
      basename: "/val",
    }
  );

  return <RouterProvider router={router} />;
}

export default App;
