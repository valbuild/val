import {
  LoadingStatus,
  useDebouncedLoadingStatus,
  useErrors,
  usePublish,
} from "./ValProvider";
import { ScrollArea } from "./ui/scroll-area";
import { DraftChanges } from "./DraftChanges";
import { X } from "lucide-react";
import classNames from "classnames";
import { urlOf } from "@valbuild/shared/internal";
import { PublishErrorDialog } from "./PublishErrorDialog";

export function ToolsMenu({
  isOpen,
  setOpen,
}: {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { globalErrors } = useErrors();
  const debouncedLoadingStatus = useDebouncedLoadingStatus();
  return (
    <nav className="flex flex-col gap-1 pr-4">
      <div className="flex items-center h-16 gap-4 p-4 mt-4 bg-bg-tertiary rounded-3xl">
        <ToolsMenuButtons isOpen={isOpen} setOpen={setOpen} />
      </div>
      {globalErrors.length > 0 && (
        <div className="p-4 bg-bg-error-primary text-text-Wprimary rounded-3xl">
          {globalErrors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      )}
      <PublishErrorDialog />
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
  isOpen,
  setOpen,
}: {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { publish, publishDisabled } = usePublish();
  return (
    <div className="flex items-center justify-end w-full gap-4 p-4">
      <div className="xl:hidden">
        <button
          className="px-3 py-1 font-bold text-bg-brand-primary"
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
          disabled={isOpen && publishDisabled}
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
      <div className="hidden xl:block">
        <button
          className="px-3 py-1 font-bold text-bg-brand-primary"
          onClick={() => {
            window.location.href = urlOf("/api/val/enable", {
              redirect_to: window.origin,
            });
          }}
        >
          <span>Visual editing</span>
        </button>
        <button
          className="px-3 py-1 font-bold transition-colors border rounded bg-bg-brand-primary disabled:text-text-disabled disabled:bg-bg-disabled disabled:border-border-disabled disabled:border border-bg-brand-primary text-text-brand-primary"
          disabled={publishDisabled}
          onClick={() => {
            publish();
          }}
        >
          <span>Publish</span>
        </button>
      </div>
    </div>
  );
}
