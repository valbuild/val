import { Loader2, Save, Upload, X } from "lucide-react";
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

// Matches the size of the MenuButton in ValOverlay: 16px icon + p-2 + border
const compactButtonClassName = "h-auto w-auto p-2";

export function PublishButton({
  /**
   * Render as an icon-only button that lines up with the other buttons in the
   * Val menu overlay. The label moves into the tooltip.
   */
  compact,
}: {
  compact?: boolean;
}) {
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
  const buttonProps = compact
    ? ({ size: "icon-sm", className: compactButtonClassName } as const)
    : ({ className: "flex gap-2 items-center" } as const);

  if (hasValidationErrors) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button {...buttonProps} disabled={true}>
            {mode === "fs" ? (
              compact ? (
                <Save size={16} />
              ) : (
                "Save"
              )
            ) : (
              <>
                {!compact && <span>{"Ready"}</span>}
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
    const label = isPublishing ? "Saving" : "Save";
    const saveButton = (
      <Button
        {...buttonProps}
        disabled={
          publishDisabled ||
          autoPublish ||
          pendingServerSidePatchIds.length === 0 ||
          pendingClientSidePatchIds.length > 0
        }
        aria-label={compact ? label : undefined}
        onClick={() => {
          publish("No summary provided");
        }}
      >
        {compact ? (
          isPublishing ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )
        ) : (
          <>
            <span>{label}</span>
            {isPublishing && <Loader2 className="animate-spin" size={16} />}
          </>
        )}
      </Button>
    );
    if (!compact) {
      return saveButton;
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>{saveButton}</TooltipTrigger>
        <TooltipContent>
          <p>{isPublishing ? "Saving changes to disk" : "Save to disk"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  const label = isPublishing ? "Pushing" : "Ready";
  const publishButton = (
    <Button
      {...buttonProps}
      disabled={
        publishDisabled ||
        pendingServerSidePatchIds.length === 0 ||
        pendingClientSidePatchIds.length > 0
      }
      aria-label={compact ? label : undefined}
      onClick={() => {
        setSummaryOpen(true);
        // Always generate a new summary when opening
        if (canGenerate) {
          const timeoutPromise = new Promise<{ type: "timeout" }>((resolve) =>
            setTimeout(() => resolve({ type: "timeout" }), 20000),
          );

          Promise.race([generateSummary(), timeoutPromise]).then((result) => {
            if (result.type === "timeout") {
              console.warn("Val: Summary generation timed out after 20s");
            } else if (result.type === "ai") {
              setSummary({ type: "ai", text: result.text.trim() });
            } else if (result.type === "error") {
              console.warn("Val: Summary generation failed:", result.message);
            }
          });
        }
      }}
    >
      {!isPublishing && (
        <>
          {!compact && <span>{"Ready"}</span>}
          <Upload size={16} />
        </>
      )}
      {isPublishing && (
        <>
          {!compact && <span>{"Pushing"}</span>}
          <Loader2 className="animate-spin" size={16} />
        </>
      )}
    </Button>
  );
  return (
    <span>
      <Popover
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open);
        }}
      >
        {compact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>{publishButton}</PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {isPublishing ? "Pushing changes" : "Publish pending changes"}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <PopoverTrigger asChild>{publishButton}</PopoverTrigger>
        )}
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
