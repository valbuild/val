import {
  CloudUpload,
  Rocket,
  Save,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { SourcePath } from "@valbuild/core";
import { Button } from "./designSystem/button";
import {
  useAllPatchErrors,
  useAutoPublish,
  useCommittedPatches,
  usePendingClientSidePatchIds,
  useHasNetChanges,
  useUnstagedPatchIds,
  usePendingServerSidePatchIds,
  usePublishingPatchIds,
  usePublishSummary,
  useValMode,
  usePublishRefusal,
} from "./ValProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useValPortal } from "./ValPortalProvider";
import { useOwnUnstagedPatchIds } from "./useOwnUnstagedPatchIds";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useAutomaticPublish } from "../hooks/useAutomaticPublish";
import { useSettingsModuleSource } from "../hooks/useSettingsModuleSource";
import {
  isCommitMessageRequired,
  readStudioSettings,
} from "../hooks/studioSettings";
import { PublishTooltip } from "./PublishTooltip";

/*
 * The overlay's Publish: the size of its other buttons (`w-8 h-8`), and round.
 * The bar it sits in is a pill and the buttons around it are ghosts, so the one
 * filled control reads as a square stamped on a round thing unless it is round
 * too.
 */
const compactButtonClassName = "h-8 w-8 p-0 rounded-full";

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
  summarising,
}: {
  kind: PublishButtonKind;
  saving: boolean;
  summarising: boolean;
}) {
  return (
    <span className="grid size-4 shrink-0 place-items-center">
      {kind === "blocked" ? (
        <TriangleAlert size={16} />
      ) : kind === "in-flight" && summarising ? (
        <Sparkles size={16} className="animate-pulse" />
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
  onHoldOpenChange,
  popoverSide,
}: {
  compact?: boolean;
  /**
   * Which side of the button the commit message popover opens on. The overlay
   * passes the side facing into the page, as its hover cards do: below the
   * button, on a menu docked to the right edge, it covered the rest of the
   * menu.
   */
  popoverSide?: "top" | "right" | "bottom" | "left";
  /**
   * Whether whatever holds this button should stay open around it: the
   * commit message popover is open, or a publish is under way.
   *
   * For the overlay's menu, which collapses when the pointer leaves it. The
   * popover is portalled out of the menu, so moving onto it IS leaving — and
   * the collapse took the button the popover is anchored to with it, so the
   * popover slid across the page under the pointer. A publish in flight is
   * held too: its progress is on this button, and a collapsed menu hides it.
   */
  onHoldOpenChange?: (hold: boolean) => void;
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const { publish, publishDisabled, isPublishing, preparePublish, aiEnabled } =
    usePublishSummary();
  const { isSummarising, publishAutomatically } = useAutomaticPublish({
    publish: (message) => {
      void publish(message);
    },
    aiEnabled,
  });
  /*
   * Asked for a message only where the project says so -- and while its
   * settings are still arriving, since "we do not know yet" must not publish
   * past a requirement. A project with no settings module has nothing to
   * require, and is never waiting on one.
   */
  const settingsModule = useSettingsModuleSource();
  const commitMessageRequired =
    (settingsModule.moduleFilePath !== null &&
      settingsModule.source === undefined) ||
    isCommitMessageRequired(readStudioSettings(settingsModule.source));
  const hold = summaryOpen || isSummarising || isPublishing;
  const onHoldOpenChangeRef = useRef(onHoldOpenChange);
  onHoldOpenChangeRef.current = onHoldOpenChange;
  useEffect(() => {
    onHoldOpenChangeRef.current?.(hold);
  }, [hold]);
  useEffect(() => () => onHoldOpenChangeRef.current?.(false), []);
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
  const unpublishedPatchIds = useMemo(
    () => savedPatchIds.filter((patchId) => !committedPatchIds.has(patchId)),
    [savedPatchIds, committedPatchIds],
  );
  /*
   * And not on its way, either. A press this tab made stops holding the
   * button once content has its job, and its changes stay uncommitted until
   * the seal -- so without this, Publish lit up at the hand-off over the
   * change it was in the middle of publishing. See `publishingPatchIds`.
   */
  const publishing = usePublishingPatchIds();
  /*
   * Nor outside this tab's patch group, anyone's: Publish does not send those.
   * Counted as work, an unstaged change beside a publishing one in the same
   * module lit Publish up over nothing staged -- the module compares as
   * changed, because of the change being published.
   */
  const unstagedPatchIds = useUnstagedPatchIds();
  const pendingServerSidePatchIds = useMemo(
    () =>
      unpublishedPatchIds.filter(
        (patchId) => !publishing.has(patchId) && !unstagedPatchIds.has(patchId),
      ),
    [unpublishedPatchIds, publishing, unstagedPatchIds],
  );
  // Counted on its own, so an unstaged change is never called "publishing".
  const publishingCount = useMemo(
    () =>
      unpublishedPatchIds.filter((patchId) => publishing.has(patchId)).length,
    [unpublishedPatchIds, publishing],
  );
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const hasNetChanges = useHasNetChanges();
  // Only this user's own held patches: the message offers to stage them, and
  // a colleague's change is not theirs to stage. See `useOwnUnstagedPatchIds`.
  const heldChangeIds = useOwnUnstagedPatchIds();
  const mode = useValMode();
  const publishRefusal = usePublishRefusal();
  const portalContainer = useValPortal();
  const { autoPublish } = useAutoPublish();
  const { navigate } = useNavigation();

  const state = describePublishButton({
    mode: mode === "fs" ? "fs" : mode === null ? "unknown" : "http",
    publishRefusal,
    validationErrorCount: validationErrorPaths.length,
    conflictingChangeCount,
    isPublishing,
    isSummarising,
    publishDisabled,
    autoPublish,
    pendingServerSidePatchCount: pendingServerSidePatchIds.length,
    publishingCount,
    pendingClientSidePatchCount: pendingClientSidePatchIds.length,
    netChangesEmpty: !hasNetChanges,
    unstagedChangeCount: heldChangeIds.size,
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
      <PublishIcon
        kind={state.kind}
        saving={saving}
        summarising={isSummarising && !isPublishing}
      />
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

  if (!commitMessageRequired) {
    /*
     * The default: pressing Publish publishes. Nobody is shown a box -- the AI
     * writes the message where there is one, and the paths that changed make
     * it where there is not. See `useAutomaticPublish`.
     */
    const button = (
      <Button
        className={buttonClassName}
        aria-label={compact ? state.description : undefined}
        onClick={() => {
          // In the press, before the AI is asked anything: see `preparePublish`.
          preparePublish();
          publishAutomatically();
        }}
      >
        {face}
      </Button>
    );
    return (
      <PublishTooltip
        label={state.description}
        description={tooltip}
        disabled={false}
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
          side={popoverSide}
          align="end"
          className="z-[9001] flex flex-col gap-4"
        >
          <PopoverClose asChild className="self-end cursor-pointer">
            <X size={12} />
          </PopoverClose>
          <PublishSummary
            onPress={preparePublish}
            onClose={() => {
              setSummaryOpen(false);
            }}
            onPublish={(summary) => {
              setSummaryOpen(false);
              // The text comes from the popover rather than from the summary
              // state read here, which is this render's copy of it.
              const summaryText = summary.trim();
              if (summaryText === "") {
                return;
              }
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
