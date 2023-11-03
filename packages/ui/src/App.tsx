import { ValApi } from "@valbuild/core";
import { ValFullscreen } from "./components/ValFullscreen";
import { ErrorBoundary } from "react-error-boundary";

import {
  Accordion,
  AccordionItem,
  AccordionContent,
  AccordionTrigger,
} from "./components/ui/accordion";
import Logo from "./assets/icons/Logo";
import { X } from "lucide-react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

function fallbackRender({ error, resetErrorBoundary }: any) {
  console.error(error);
  return (
    <div className="absolute top-0 left-0 flex items-center justify-center w-screen h-screen bg-card-foreground">
      <div className="w-full h-full p-10">
        <div className="w-full h-full p-10 bg-card text-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[0.5em] text-lg font-bold text-center py-2">
              <Logo /> encountered an error
            </div>
            <button onClick={resetErrorBoundary}>
              <X />
            </button>
          </div>
          <div className="text-4xl font-normal ">Message: {error.message}</div>
          <Accordion
            type="single"
            className="font-serif"
            collapsible
            defaultValue="error"
          >
            <AccordionItem value={"error"}>
              <AccordionTrigger>Stack trace:</AccordionTrigger>
              <AccordionContent className="p-4 bg-popover text-popover-foreground">
                {error.stack && <pre>{error.stack}</pre>}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}

function App() {
  const router = createBrowserRouter(
    [
      {
        path: "/*",
        element: <ValFullscreen valApi={new ValApi("/api/val")} />,
      },
    ],
    {
      basename: "/api/val/static/edit",
    }
  );

  return (
    <ErrorBoundary fallbackRender={fallbackRender}>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

export default App;
