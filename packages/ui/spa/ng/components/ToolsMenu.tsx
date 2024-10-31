import { LoadingStatus, useLoadingStatus } from "../ValProvider";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useState, useEffect } from "react";
import { DraftChanges } from "./DraftChanges";

export function ToolsMenu() {
  const loadingStatus = useLoadingStatus();
  const [debouncedLoadingStatus, setDebouncedLoadingStatus] =
    useState(loadingStatus);
  useEffect(() => {
    if (loadingStatus === "success") {
      const timeout = setTimeout(() => {
        setDebouncedLoadingStatus(loadingStatus);
      }, 100);
      return () => {
        clearTimeout(timeout);
      };
    } else {
      setDebouncedLoadingStatus(loadingStatus);
    }
  }, [loadingStatus]);
  return (
    <nav className="flex flex-col gap-1 pr-4">
      <div className="flex items-center h-16 gap-4 p-4 mt-4 bg-bg-tertiary rounded-3xl">
        <ToolsMenuButtons loadingStatus={loadingStatus} />
      </div>
      {debouncedLoadingStatus === "error" && <div className="">Error</div>}
      {debouncedLoadingStatus !== "not-asked" && (
        <div className="hidden bg-bg-tertiary rounded-3xl xl:block">
          <ScrollArea>
            <div className="max-h-[calc(100svh-32px-64px-32px-16px)]">
              <DraftChanges loadingStatus={debouncedLoadingStatus} />
            </div>
          </ScrollArea>
        </div>
      )}
    </nav>
  );
}

export function ToolsMenuButtons({
  loadingStatus,
}: {
  loadingStatus: LoadingStatus;
}) {
  return (
    <div className="flex items-center justify-end w-full gap-4 p-4">
      <button className="px-3 py-1 font-bold text-bg-brand-primteary">
        Visual editing
      </button>
      <button
        className="px-3 py-1 font-bold transition-colors border rounded bg-bg-brand-primary disabled:text-text-disabled disabled:bg-bg-disabled disabled:border-border-disabled disabled:border border-bg-brand-primary text-text-brand-primary"
        disabled={loadingStatus !== "success"}
      >
        <span>Publish</span>
      </button>
    </div>
  );
}
