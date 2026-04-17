import {
  Accordion,
  AccordionItem,
  AccordionContent,
  AccordionTrigger,
} from "./components/designSystem/accordion";
import Logo from "./assets/icons/Logo";
import { X } from "lucide-react";
import { useCurrentPatchIds, useDeletePatches } from "./components/ValProvider";
import { Button } from "./components/designSystem/button";

function ErrorContent({
  error,
  resetErrorBoundary,
  onDeleteAllPatches,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  resetErrorBoundary: () => void;
  onDeleteAllPatches?: () => void;
}) {
  return (
    <div className="flex absolute top-0 left-0 justify-center items-center w-screen h-screen bg-bg-primary text-fg-primary">
      <div className="p-10 w-full h-full">
        <div className="overflow-scroll p-10 w-full h-full bg-card text-fg-primary">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-[0.5em] text-lg font-bold text-center py-2">
              <Logo /> encountered an error
              <button onClick={resetErrorBoundary}>
                <X />
              </button>
            </div>
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
          {onDeleteAllPatches && (
            <div className="flex flex-col gap-4 py-8">
              <p className="max-w-prose text-pretty">
                If this problem was caused by a recent change, you can revert
                all recent changes by clicking the button below. If the problem
                persists after reverting changes, a developer needs to
                investigate.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  variant={"destructive"}
                  onClick={onDeleteAllPatches}
                  className="text-sm px-3 py-1.5 rounded border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  Revert all changes
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fallbackRender({ error, resetErrorBoundary }: any) {
  console.error(error);
  return <ErrorContent error={error} resetErrorBoundary={resetErrorBoundary} />;
}

export function FallbackComponent({
  error,
  resetErrorBoundary,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  resetErrorBoundary: () => void;
}) {
  console.error(error);
  const currentPatchIds = useCurrentPatchIds();
  const { deletePatches } = useDeletePatches();
  const onDeleteAllPatches =
    currentPatchIds.length > 0
      ? () => {
          deletePatches(currentPatchIds);
          resetErrorBoundary();
        }
      : undefined;
  return (
    <ErrorContent
      error={error}
      resetErrorBoundary={resetErrorBoundary}
      onDeleteAllPatches={onDeleteAllPatches}
    />
  );
}
