import {
  Accordion,
  AccordionItem,
  AccordionContent,
  AccordionTrigger,
} from "./components/designSystem/accordion";
import Logo from "./assets/icons/Logo";
import { X } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fallbackRender({ error, resetErrorBoundary }: any) {
  console.error(error);
  return (
    <div className="flex absolute top-0 left-0 justify-center items-center w-screen h-screen bg-bg-primary text-fg-primary">
      <div className="p-10 w-full h-full">
        <div className="overflow-scroll p-10 w-full h-full bg-card text-fg-primary">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-[0.5em] text-lg font-bold text-center py-2">
              <Logo /> encountered an error
            </div>
            <button onClick={resetErrorBoundary}>
              <X />
            </button>
          </div>
          <div className="text-4xl font-normal">Message:</div>
          <pre>{error.message}</pre>
          {error.stack && (
            <Accordion
              type="single"
              className="font-serif"
              collapsible
              defaultValue="error"
            >
              <AccordionItem value={"error"}>
                <AccordionTrigger>Stack trace:</AccordionTrigger>
                <AccordionContent className="p-4 bg-bg-secondary">
                  {error.stack && <pre>{error.stack}</pre>}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      </div>
    </div>
  );
}
