import {
  useDebouncedLoadingStatus,
  usePublish,
  useValMode,
} from "./ValProvider";
import { ScrollArea } from "./designSystem/scroll-area";
import { DraftChanges } from "./DraftChanges";
import classNames from "classnames";
import { PublishErrorDialog } from "./PublishErrorDialog";
import { Eye, Loader2, PanelRightOpen, Upload } from "lucide-react";
import { useLayout } from "./Layout";
import { Button } from "./designSystem/button";
import { urlOf } from "@valbuild/shared/internal";

export function ToolsMenu() {
  const debouncedLoadingStatus = useDebouncedLoadingStatus();
  return (
    <div className="min-h-[100svh] bg-bg-primary">
      <div className="h-16 border-b border-border-primary">
        <ToolsMenuButtons />
      </div>
      <PublishErrorDialog />
      {debouncedLoadingStatus !== "not-asked" && (
        <div className={classNames("", {})}>
          <ScrollArea>
            <div className="max-h-[calc(100svh-64px)] border-b border-border-primary">
              <DraftChanges loadingStatus={debouncedLoadingStatus} />
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

export function ToolsMenuButtons() {
  const { publish, isPublishing, publishDisabled } = usePublish();
  const mode = useValMode();
  const { navMenu, toolsMenu } = useLayout();
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between w-full gap-2 p-4">
        <button
          className="lg:hidden"
          onClick={() => {
            toolsMenu.setOpen(!toolsMenu.isOpen);
          }}
        >
          <PanelRightOpen
            size={16}
            className={classNames("transform", {
              "rotate-180": !navMenu.isOpen,
            })}
          />
        </button>
        <div className="flex items-center justify-end w-full gap-2">
          <Button
            className="flex items-center gap-2"
            variant={"outline"}
            onClick={() => {
              window.location.href = urlOf("/api/val/enable", {
                redirect_to: window.origin,
              });
            }}
          >
            <span>Preview</span>
            <Eye size={16} />
          </Button>
          <Button
            className="flex items-center gap-2"
            disabled={publishDisabled}
            onClick={() => {
              publish();
            }}
          >
            <span>{mode === "fs" ? "Save" : "Publish"}</span>
            <Upload size={16} />
          </Button>
        </div>
      </div>
      {isPublishing && (
        <div className="flex items-center justify-end gap-2 p-4 text-right border-t bg-bg-tertiary text-text-primary border-border-primary">
          <span>Publishing changes </span>
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
    </div>
  );
}
