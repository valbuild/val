import { CloudUpload, Rocket, Save, TriangleAlert, X } from "lucide-react";
import { SourcePath } from "@valbuild/core";
import { Button } from "./designSystem/button";
import {
  useAllPatchErrors,
  useAutoPublish,
  useCommittedPatches,
  usePendingClientSidePatchIds,
  useHasNetChanges,
  usePendingServerSidePatchIds,
  usePublishSummary,
  useValMode,
} from "./ValProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useValPortal } from "./ValPortalProvider";
import { useOwnHeldPatchIds } from "./useOwnHeldPatchIds";
import { useNavigation, VAL_ERRORS_ROUTE } from "./ValRouter";
import {
  describePublishButton,
  type PublishButtonKind,
} from "./publishButtonState";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import { PublishSummary } from "./PublishSummary";
import { type ReactElement, useMemo, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

// Matches the size of the MenuButton in ValOverlay: 16px icon + p-2 + border
const compactButtonClassName = "h-auto w-auto p-2";

/**
 * The icon for each state, at one size, always present.
 *
 * Always present is the point: the button used to render an icon in some states
 * and not others, so it changed width as it changed state — and on a phone,
 * where it is half the bottom bar, that moved the control next to it. The slot
 * is a fixed box whatever is in it.
 *
 * `CloudUpload` while in flight, because that is where the bytes are going. A
 * distinct icon for ready, because "about to send" and "sending" must not look
 * the same at a glance.
 */
function PublishIcon({
  kind,
  saving,
}: {
  kind: PublishButtonKind;
  saving: boolean;
}) {
  return (
    <span className="grid size-4 shrink-0 place-items-center">
      {kind === "blocked" ? (
        <TriangleAlert size={16} />
      ) : kind === "in-flight" ? (
        <CloudUpload size={16} className="animate-pulse" />
      ) : saving ? (
        <Save size={16} />
      ) : (
        <Rocket size={16} />
      )}
    </span>
  );
}

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
  const { publish, publishDisabled, isPublishing, summary } =
    usePublishSummary();
  const allValidationErrors = useAllValidationErrors();
  const validationErrorPaths = Object.keys(allValidationErrors ?? {});
  const { patchErrors } = useAllPatchErrors();
  const conflictingChangeCount = Object.values(patchErrors || {}).reduce(
    (count, errors) => count + Object.keys(errors || {}).length,
    0,
  );
  const savedPatchIds = usePendingServerSidePatchIds();
  const committedPatchIds = useCommittedPatches();
  /*
   * On the server and not yet shipped.
   *
   * `usePendingServerSidePatchIds` is "everything the server has heard about",
   * which keeps counting a patch after it has been committed. `useHasNetChanges`
   * does not — it looks only at uncommitted work — so straight after an HTTP
   * publish the two disagreed: a nonzero count with no net changes, which reads
   * as `revertedToNothing` and told people to Discard changes that are in a
   * commit and cannot be discarded. Same subtraction `ValShell` does for the
   * discard count, so the button and the confirm are counting the same patches.
   */
  const pendingServerSidePatchIds = useMemo(
    () => savedPatchIds.filter((patchId) => !committedPatchIds.has(patchId)),
    [savedPatchIds, committedPatchIds],
  );
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const hasNetChanges = useHasNetChanges();
  // Only this user's own held patches: the message offers to stage them, and
  // a colleague's change is not theirs to stage. See `useOwnHeldPatchIds`.
  const heldChangeIds = useOwnHeldPatchIds();
  const mode = useValMode();
  const portalContainer = useValPortal();
  const { autoPublish } = useAutoPublish();
  const { navigate } = useNavigation();

  const state = describePublishButton({
    mode: mode === "fs" ? "fs" : mode === null ? "unknown" : "http",
    validationErrorCount: validationErrorPaths.length,
    conflictingChangeCount,
    isPublishing,
    publishDisabled,
    autoPublish,
    pendingServerSidePatchCount: pendingServerSidePatchIds.length,
    pendingClientSidePatchCount: pendingClientSidePatchIds.length,
    netChangesEmpty: !hasNetChanges,
    heldChangeCount: heldChangeIds.size,
  });
  const saving = mode === "fs";
  /*
   * One size in every state.
   *
   * The labels differ in length — "Save", "Saving", "Publish", "Fix 3" — so a
   * button that hugged its text moved every time the state changed. A minimum
   * width sized for the longest of them, and the icon in a fixed box, means the
   * only thing that changes is what it says.
   */
  const buttonClassName = compact
    ? compactButtonClassName
    : /*
       * `h-8`, matching `PreviewButton` — its neighbour in the top bar.
       *
       * The design system's `Button` is `h-10` by default, so this stood two
       * pixels short of a quarter-inch taller than everything else on the row and
       * made the bar look mis-set. `text-xs font-medium` for the same reason: the
       * row is one scale.
       */
      "flex h-8 min-w-[6.5rem] items-center justify-center gap-2 px-3 text-xs font-medium";

  /** Everything except "press me": rendered the same way in every state. */
  const face = (
    <>
      <PublishIcon kind={state.kind} saving={saving} />
      {!compact && <span>{state.label}</span>}
    </>
  );
  const tooltip = state.reason ?? state.description;

  if (state.kind === "blocked") {
    /*
     * Pressable, and it goes to the errors.
     *
     * This used to be a disabled button with the reason in a tooltip — which on
     * a phone is nothing at all: no hover, and the errors are behind a panel. A
     * button that names a problem should be the way to it.
     */
    const button = (
      <Button
        className={buttonClassName}
        variant={state.action === "show-errors" ? "destructive" : "default"}
        disabled={state.action === "none"}
        aria-label={compact ? state.description : undefined}
        onClick={() => {
          if (state.action === "show-errors") {
            navigate(VAL_ERRORS_ROUTE, {
              errorFields: validationErrorPaths as SourcePath[],
            });
          }
        }}
      >
        {face}
      </Button>
    );
    return (
      <PublishTooltip
        label={state.description}
        description={tooltip}
        disabled={state.action === "none"}
        container={portalContainer}
      >
        {button}
      </PublishTooltip>
    );
  }

  if (saving || state.kind !== "ready") {
    const button = (
      <Button
        className={buttonClassName}
        disabled={state.action === "none"}
        aria-label={compact ? state.description : undefined}
        onClick={() => {
          if (state.action === "save") {
            publish("No summary provided");
          }
        }}
      >
        {face}
      </Button>
    );
    return (
      <PublishTooltip
        label={state.description}
        description={tooltip}
        disabled={state.action === "none"}
        container={portalContainer}
      >
        {button}
      </PublishTooltip>
    );
  }

  const publishButton = (
    <Button
      className={buttonClassName}
      aria-label={compact ? state.description : undefined}
      onClick={() => {
        // Generation starts when the popover mounts, which is this same press —
        // it lives with the summary it fills in, not with the button.
        setSummaryOpen(true);
      }}
    >
      {face}
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
            label={state.description}
            description={tooltip}
            disabled={false}
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
