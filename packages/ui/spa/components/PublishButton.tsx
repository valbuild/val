import { Loader2, Save, Upload, X } from "lucide-react";
import { Button } from "./designSystem/button";
import {
  useAllPatchErrors,
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
import { type ReactElement, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

// Matches the size of the MenuButton in ValOverlay: 16px icon + p-2 + border
const compactButtonClassName = "h-auto w-auto p-2";

// What the button does, rather than what state it is in: used both as the
// tooltip text and - when the button is icon-only - as its accessible name
const saveDescription = "Save to disk";
const savingDescription = "Saving changes to disk";
const publishDescription = "Publish pending changes";
const pushingDescription = "Pushing changes";

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
  const { patchErrors } = useAllPatchErrors();
  const conflictingChangeCount = Object.values(patchErrors || {}).reduce(
    (count, errors) => count + Object.keys(errors || {}).length,
    0,
  );
  const pendingServerSidePatchIds = usePendingServerSidePatchIds();
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const mode = useValMode();
  const portalContainer = useValPortal();
  const { autoPublish } = useAutoPublish();
  const buttonClassName = compact
    ? compactButtonClassName
    : "flex gap-2 items-center";

  if (hasValidationErrors || conflictingChangeCount > 0) {
    // when compact the button is icon-only, so its name has to say what it
    // does; otherwise it has to match the label the button actually shows
    const label = compact
      ? mode === "fs"
        ? saveDescription
        : publishDescription
      : mode === "fs"
        ? "Save"
        : "Ready";
    // Both reasons can hold at once and each is separately actionable, so the
    // tooltip names every one that applies rather than only the first.
    const reasons: string[] = [];
    if (hasValidationErrors) {
      reasons.push("Fix validation errors to continue.");
    }
    if (conflictingChangeCount > 0) {
      // Without this the button stayed enabled and the publish failed
      // server-side with nothing actionable to show for it.
      reasons.push(
        `${conflictingChangeCount} change${
          conflictingChangeCount === 1 ? "" : "s"
        } cannot be applied. Remove ${
          conflictingChangeCount === 1 ? "it" : "them"
        } to continue.`,
      );
    }
    return (
      <PublishTooltip
        label={label}
        description={reasons.join(" ")}
        disabled={true}
        container={portalContainer}
      >
        <Button className={buttonClassName} disabled={true}>
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
      </PublishTooltip>
    );
  }

  if (mode === "fs") {
    const label = isPublishing ? "Saving" : "Save";
    const description = isPublishing ? savingDescription : saveDescription;
    const saveDisabled =
      publishDisabled ||
      autoPublish ||
      pendingServerSidePatchIds.length === 0 ||
      pendingClientSidePatchIds.length > 0;
    const saveButton = (
      <Button
        className={buttonClassName}
        disabled={saveDisabled}
        // icon-only: the accessible name has to say what the button does
        aria-label={compact ? description : undefined}
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
      <PublishTooltip
        label={description}
        description={description}
        disabled={saveDisabled}
        container={portalContainer}
      >
        {saveButton}
      </PublishTooltip>
    );
  }
  const description = isPublishing ? pushingDescription : publishDescription;
  const publishIsDisabled =
    publishDisabled ||
    pendingServerSidePatchIds.length === 0 ||
    pendingClientSidePatchIds.length > 0;
  const publishButton = (
    <Button
      className={buttonClassName}
      disabled={publishIsDisabled}
      // icon-only: the accessible name has to say what the button does
      aria-label={compact ? description : undefined}
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
    // inline-flex, not a plain inline span: an inline box around the button
    // adds the inherited line-height's descender space below it, which is
    // exactly the misalignment this button is trying to avoid in the menu
    <span className="inline-flex">
      <Popover
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open);
        }}
      >
        {compact ? (
          <PublishTooltip
            label={description}
            description={description}
            disabled={publishIsDisabled}
            container={portalContainer}
          >
            <PopoverTrigger asChild>{publishButton}</PopoverTrigger>
          </PublishTooltip>
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

/**
 * Tooltip on the publish button.
 *
 * When the button is disabled it cannot be the tooltip trigger itself: the
 * design system gives disabled buttons `pointer-events-none` (so they never
 * receive hover) and `disabled` takes them out of the tab order (so they
 * never receive focus), which would leave the tooltip - the only place the
 * icon-only button explains itself - impossible to open. In that state the
 * trigger is a focusable wrapper that carries the name and the disabled state
 * of the action, and the button below it is hidden from assistive technology
 * so the action is not announced twice.
 */
function PublishTooltip({
  label,
  description,
  disabled,
  container,
  children,
}: {
  label: string;
  description: string;
  disabled: boolean;
  container: HTMLElement | null;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span
            className="inline-flex"
            role="button"
            tabIndex={0}
            aria-disabled="true"
            aria-label={label}
          >
            <span className="inline-flex" aria-hidden="true">
              {children}
            </span>
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent container={container}>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
