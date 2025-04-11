import { Loader2, Upload, X } from "lucide-react";
import { Button } from "./designSystem/button";
import {
  useAllValidationErrors,
  useCurrentPatchIds,
  usePublishSummary,
  useValMode,
  useValPortal,
} from "./ValProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import { PublishSummary } from "./PublishSummary";
import { useState } from "react";

export function PublishButton() {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const { publish, publishDisabled, isPublishing, summary } =
    usePublishSummary();
  const allValidationErrors = useAllValidationErrors();
  const patchIds = useCurrentPatchIds();
  const hasPatchIds = patchIds.length > 0;
  const hasValidationErrors =
    allValidationErrors !== undefined &&
    Object.keys(allValidationErrors).length > 0;
  const mode = useValMode();
  const portalContainer = useValPortal();
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
            className="flex items-center gap-2"
            disabled={publishDisabled || hasValidationErrors || !hasPatchIds}
            title={hasValidationErrors ? "Please fix validation errors" : ""}
            onClick={() => {
              if (mode === "fs") {
                publish("Saved");
                return;
              }
              setSummaryOpen(true);
            }}
          >
            {!isPublishing && (
              <>
                <span>{mode === "fs" ? "Save" : "Ready"}</span>
                <Upload size={16} />
              </>
            )}
            {isPublishing && (
              <>
                <span>{mode === "fs" ? "Saving" : "Pushing"}</span>
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
