import { Loader2, Upload, X } from "lucide-react";
import { Button } from "./designSystem/button";
import {
  useAutoPublish,
  usePendingClientSidePatchIds,
  usePendingServerSidePatchIds,
  usePublishSummary,
  useValMode,
} from "./ValProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useValPortal } from "./ValPortalProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import { PublishSummary } from "./PublishSummary";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

export function PublishButton() {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const {
    publish,
    publishDisabled,
    isPublishing,
    summary,
    generateSummary,
    setSummary,
    canGenerate,
  } = usePublishSummary();
  const allValidationErrors = useAllValidationErrors();
  const hasValidationErrors =
    allValidationErrors !== undefined &&
    Object.keys(allValidationErrors).length > 0;
  const pendingServerSidePatchIds = usePendingServerSidePatchIds();
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const mode = useValMode();
  const portalContainer = useValPortal();
  const { autoPublish } = useAutoPublish();

  if (hasValidationErrors) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button className="flex gap-2 items-center" disabled={true}>
            {mode === "fs" ? (
              "Save"
            ) : (
              <>
                <span>{"Ready"}</span>
                <Upload size={16} />
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex flex-col gap-2">
            <p>Fix validation errors to continue</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (mode === "fs") {
    return (
      <Button
        className="flex gap-2 items-center"
        disabled={
          publishDisabled ||
          hasValidationErrors ||
          autoPublish ||
          pendingServerSidePatchIds.length === 0 ||
          pendingClientSidePatchIds.length > 0
        }
        title={hasValidationErrors ? "Please fix validation errors" : ""}
        onClick={() => {
          publish("No summary provided");
        }}
      >
        {!hasValidationErrors ? (
          <span>{isPublishing ? "Saving" : "Save"}</span>
        ) : (
          <span>{"Save"}</span>
        )}
        {isPublishing && <Loader2 className="animate-spin" size={16} />}
      </Button>
    );
  }
  return (
    <span>
      <Popover
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            className="flex gap-2 items-center"
            disabled={
              publishDisabled ||
              hasValidationErrors ||
              pendingServerSidePatchIds.length === 0 ||
              pendingClientSidePatchIds.length > 0
            }
            onClick={() => {
              setSummaryOpen(true);
              // Always generate a new summary when opening
              if (canGenerate) {
                const timeoutPromise = new Promise<{ type: "timeout" }>(
                  (resolve) =>
                    setTimeout(() => resolve({ type: "timeout" }), 20000),
                );

                Promise.race([generateSummary(), timeoutPromise]).then(
                  (result) => {
                    if (result.type === "timeout") {
                      console.warn(
                        "Val: Summary generation timed out after 20s",
                      );
                    } else if (result.type === "ai") {
                      setSummary({ type: "ai", text: result.text.trim() });
                    } else if (result.type === "error") {
                      console.warn(
                        "Val: Summary generation failed:",
                        result.message,
                      );
                    }
                  },
                );
              }
            }}
          >
            {!isPublishing && (
              <>
                <span>{"Ready"}</span>
                <Upload size={16} />
              </>
            )}
            {isPublishing && (
              <>
                <span>{"Pushing"}</span>
                <Loader2 className="animate-spin" size={16} />
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          container={portalContainer}
          align="end"
          className="z-[9001] flex flex-col gap-4"
        >
          <PopoverClose asChild className="self-end cursor-pointer">
            <X size={12} />
          </PopoverClose>
          <PublishSummary
            onClose={() => {
              setSummaryOpen(false);
            }}
            onPublish={() => {
              setSummaryOpen(false);
              if (summary.type === "not-asked") {
                return;
              }
              const summaryText = summary.text.trim();
              publish(summaryText);
            }}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}
