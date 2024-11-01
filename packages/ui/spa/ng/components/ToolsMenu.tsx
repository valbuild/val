import { LoadingStatus, useLoadingStatus, usePublish } from "../ValProvider";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useState, useEffect } from "react";
import { DraftChanges } from "./DraftChanges";
import { X } from "lucide-react";
import classNames from "classnames";
import { urlOf } from "@valbuild/shared/internal";

export function ToolsMenu({
  isOpen,
  setOpen,
}: {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
  const loadingStatus = useLoadingStatus();
  // Debounce loading status to avoid flickering...
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
  const { publishError } = usePublish();

  return (
    <nav className="flex flex-col gap-1 pr-4">
      <div className="flex items-center h-16 gap-4 p-4 mt-4 bg-bg-tertiary rounded-3xl">
        <ToolsMenuButtons
          loadingStatus={loadingStatus}
          isOpen={isOpen}
          setOpen={setOpen}
        />
      </div>
      {debouncedLoadingStatus === "error" && (
        <div className="bg-bg-error-primary text-text-error-primary rounded-3xl">
          Could not fetch data
        </div>
      )}
      {publishError && (
        <div className="bg-bg-error-primary text-text-error-primary rounded-3xl">
          {publishError}
        </div>
      )}
      {debouncedLoadingStatus !== "not-asked" && (
        <div
          className={classNames("bg-bg-tertiary rounded-3xl", {
            "hidden xl:block": !isOpen,
            block: isOpen,
          })}
        >
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
  isOpen,
  setOpen,
}: {
  loadingStatus: LoadingStatus;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { publish, isPublishing } = usePublish();
  return (
    <div className="flex items-center justify-end w-full gap-4 p-4">
      <button
        className="px-3 py-1 font-bold text-bg-brand-primteary"
        onClick={() => {
          if (isOpen) {
            setOpen(false);
          } else {
            window.location.href = urlOf("/api/val/enable", {
              redirect_to: window.origin,
            });
          }
        }}
      >
        {!isOpen && <span>Visual editing</span>}
        {isOpen && (
          <span>
            <X />
          </span>
        )}
      </button>
      <button
        className="px-3 py-1 font-bold transition-colors border rounded bg-bg-brand-primary disabled:text-text-disabled disabled:bg-bg-disabled disabled:border-border-disabled disabled:border border-bg-brand-primary text-text-brand-primary"
        disabled={loadingStatus !== "success" || isPublishing}
        onClick={() => {
          if (!isOpen) {
            setOpen(true);
          } else {
            publish();
          }
        }}
      >
        {isOpen && <span>Publish</span>}
        {!isOpen && <span>Review</span>}
      </button>
    </div>
  );
}
