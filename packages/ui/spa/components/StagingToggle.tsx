import { PatchId } from "@valbuild/core";
import classNames from "classnames";
import { Check, EyeOff, Minus } from "lucide-react";
import { Profile } from "./ValProvider";
import { usePatchStaging } from "./PatchStagingProvider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

/**
 * Stage / unstage a compare-view row: a status pill and the button that changes it.
 *
 * Three states, and the middle one is the point of the feature: **held** means the
 * change exists, is not in your preview, and will not be published when you hit
 * Publish. Someone else may still publish it.
 *
 * The pill and the button are SEPARATE, which is a correction. One clickable pill
 * did both jobs, and a pill reads as a badge — the thing that tells you the state,
 * not the thing that changes it. Nothing said it could be clicked. So the pill is
 * now a plain label and the action is a button that says what it will do.
 *
 * Toggling can move more than the row you clicked, because a patch set is the unit
 * that must move together. When it does, the tooltip names what else moves and
 * whose it is — silently enlarging or shrinking somebody's publish is the failure
 * mode this control exists to avoid.
 */
export function StagingToggle({
  patchIds,
  profilesByAuthorIds,
  label,
}: {
  patchIds: readonly PatchId[];
  profilesByAuthorIds: Record<string, Profile>;
  /** What this row is, for the accessible name. */
  label: string;
}) {
  const staging = usePatchStaging();
  if (!staging.enabled || patchIds.length === 0) {
    return null;
  }

  const state = staging.stateOf(patchIds);
  const isHeld = state === "held";
  // A partial row is treated as "not fully staged", so the action is to stage.
  const willStage = state !== "staged";
  const alsoMoved = willStage
    ? staging.stagePreview(patchIds)
    : staging.unstagePreview(patchIds);

  const onToggle = () => {
    if (willStage) {
      staging.stage(patchIds);
    } else {
      staging.unstage(patchIds);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={classNames(
              "inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2 py-1",
              "text-xs leading-none",
              {
                "border-border-brand-primary text-fg-brand-primary":
                  state === "staged",
                "border-border-primary text-fg-secondary": isHeld,
                "border-border-primary text-fg-primary": state === "partial",
              },
            )}
          >
            {state === "staged" && <Check size={12} aria-hidden />}
            {state === "partial" && <Minus size={12} aria-hidden />}
            {isHeld && <EyeOff size={12} aria-hidden />}
            <span>
              {state === "staged"
                ? "Staged"
                : isHeld
                  ? "Held"
                  : "Partly staged"}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-72">
            {isHeld
              ? "Not in your preview and will not be published when you publish."
              : state === "partial"
                ? "Partly held: some of this will publish and some will not. Stage it to publish all of it."
                : "In your preview and will be published when you publish."}
          </p>
        </TooltipContent>
      </Tooltip>
      <StagingActionButton
        onClick={onToggle}
        ariaLabel={willStage ? `Stage ${label}` : `Unstage ${label}`}
        alsoMoved={alsoMoved}
        willStage={willStage}
        profilesByAuthorIds={profilesByAuthorIds}
      >
        {willStage ? "Stage" : "Unstage"}
      </StagingActionButton>
    </span>
  );
}

/**
 * The button that actually moves something, wherever it appears.
 *
 * Shared by the row control and the bulk actions so that "what else does this
 * move" is worded once. When a click would move more than what it names, the
 * tooltip says so and whose work it is; when it moves exactly what it says, there
 * is no tooltip, because a tooltip that only repeats the label is noise.
 */
function StagingActionButton({
  onClick,
  ariaLabel,
  alsoMoved,
  willStage,
  profilesByAuthorIds,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  alsoMoved: PatchId[];
  willStage: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  children: React.ReactNode;
}) {
  const staging = usePatchStaging();
  const button = (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={classNames(
        "inline-flex items-center shrink-0 rounded-md border border-border-primary px-2 py-1",
        "text-xs leading-none text-fg-primary transition-colors",
        "hover:bg-bg-secondary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-brand-primary",
      )}
    >
      {children}
    </button>
  );
  if (alsoMoved.length === 0) {
    return button;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <p className="max-w-72">
          {willStage ? "Also stages " : "Also unstages "}
          {describeAlsoMoved(alsoMoved, staging, profilesByAuthorIds)}, because
          they are part of the same change and cannot be published separately.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function describeAlsoMoved(
  alsoMoved: PatchId[],
  staging: ReturnType<typeof usePatchStaging>,
  profilesByAuthorIds: Record<string, Profile>,
): string {
  const names = new Set<string>();
  for (const patchId of alsoMoved) {
    const authorId = staging.authorOf(patchId);
    const profile = authorId ? profilesByAuthorIds[authorId] : undefined;
    names.add(profile?.fullName || "another author");
  }
  const count = alsoMoved.length;
  const changes = `${count} other ${count === 1 ? "change" : "changes"}`;
  if (names.size === 0) {
    return changes;
  }
  return `${changes} (${Array.from(names).join(", ")})`;
}

/**
 * Bulk stage / unstage for a whole section, and per author when staging.
 *
 * Two reasons this is not just a convenience over clicking each row.
 *
 * The first is scale: a review screen with twenty changes makes "hold everything
 * that is not mine" twenty clicks, and twenty chances to miss one and publish it.
 *
 * The second is that PER AUTHOR is the shape of the actual job — but only in ONE
 * direction. Staging by author is how you put your own work back after holding
 * things, so those buttons stay. Unstaging by author does not get the same
 * treatment: "unstage everything Bob wrote" is a judgement about somebody else's
 * work made in one click, across places you have not looked, and the row control
 * already covers the case where you looked and decided. So the staged section
 * offers "Unstage all" and nothing finer.
 *
 * Buttons name a COUNT, not just an action ("Unstage Bob's 3"). What a bulk button
 * is about to move is the thing that is easy to get wrong and impossible to see,
 * and the closure can make it more than the count shown — so where it would, the
 * tooltip says so, exactly as it does on a row.
 */
export function StagingBulkActions({
  patchIds,
  profilesByAuthorIds,
  side,
}: {
  /** Every patch id in this section, in chain order. */
  patchIds: readonly PatchId[];
  profilesByAuthorIds: Record<string, Profile>;
  /** Which section this is: what it holds decides what the buttons do. */
  side: "staged" | "held";
}) {
  const staging = usePatchStaging();
  if (!staging.enabled || patchIds.length === 0) {
    return null;
  }
  const willStage = side === "held";
  const act = (ids: readonly PatchId[]) => () => {
    if (willStage) {
      staging.stage(ids);
    } else {
      staging.unstage(ids);
    }
  };
  const preview = (ids: readonly PatchId[]) =>
    willStage ? staging.stagePreview(ids) : staging.unstagePreview(ids);
  const verb = willStage ? "Stage" : "Unstage";

  // Grouped by author, in the order authors first appear, so the buttons do not
  // reshuffle under the cursor when a patch moves between sections.
  const byAuthor = new Map<string | null, PatchId[]>();
  for (const patchId of patchIds) {
    const authorId = staging.authorOf(patchId);
    const existing = byAuthor.get(authorId);
    if (existing) {
      existing.push(patchId);
    } else {
      byAuthor.set(authorId, [patchId]);
    }
  }

  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      {/*
       * Per author only when STAGING. See this component's doc: putting your own
       * work back is yours to do in bulk; removing somebody else's is not.
       */}
      {willStage &&
        byAuthor.size > 1 &&
        [...byAuthor].map(([authorId, ids]) => {
          const name =
            (authorId ? profilesByAuthorIds[authorId]?.fullName : null) ??
            "another author";
          return (
            <StagingActionButton
              key={authorId ?? "unknown"}
              onClick={act(ids)}
              ariaLabel={`${verb} ${ids.length} ${
                ids.length === 1 ? "change" : "changes"
              } by ${name}`}
              alsoMoved={preview(ids)}
              willStage={willStage}
              profilesByAuthorIds={profilesByAuthorIds}
            >
              {`${verb} ${name}'s ${ids.length}`}
            </StagingActionButton>
          );
        })}
      <StagingActionButton
        onClick={act(patchIds)}
        ariaLabel={`${verb} all ${patchIds.length} ${
          patchIds.length === 1 ? "change" : "changes"
        }`}
        alsoMoved={preview(patchIds)}
        willStage={willStage}
        profilesByAuthorIds={profilesByAuthorIds}
      >
        {`${verb} all`}
      </StagingActionButton>
    </span>
  );
}

/**
 * Summary of what this group is holding back, for the compare view header.
 *
 * Held changes must stay visible. If unstaging something made it disappear from
 * the review screen, unstaging would be a one-way trapdoor — you could not find
 * the change again to put it back.
 */
export function HeldSummary() {
  const staging = usePatchStaging();
  if (!staging.enabled || staging.held.length === 0) {
    return null;
  }
  // Deduplicated: one patch can belong to two patch sets — any `move` does — and
  // would otherwise be counted once per set.
  const heldIds = new Set<PatchId>();
  for (const { unstaged } of staging.held) {
    for (const patchId of unstaged) {
      heldIds.add(patchId);
    }
  }
  const count = heldIds.size;
  return (
    <p className="text-sm text-fg-secondary">
      {count} {count === 1 ? "change is" : "changes are"} held back and will not
      be published.{" "}
      <span className="text-fg-tertiary">
        They still exist, and someone else may publish them.
      </span>
    </p>
  );
}
