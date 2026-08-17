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
 * Stage / unstage a compare-view row.
 *
 * Three states, and the middle one is the point of the feature: **held** means the
 * change exists, is not in your preview, and will not be published when you hit
 * Publish. Someone else may still publish it.
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={state === "staged"}
          aria-label={willStage ? `Stage ${label}` : `Unstage ${label}`}
          onClick={onToggle}
          className={classNames(
            "inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2 py-1",
            "text-xs leading-none transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-brand-primary",
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
            {state === "staged" ? "Staged" : isHeld ? "Held" : "Partly staged"}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-72">
          {isHeld
            ? "Not in your preview and will not be published when you publish."
            : state === "partial"
              ? "Partly held: some of this will publish and some will not. Stage it to publish all of it."
              : "In your preview and will be published when you publish."}
          {alsoMoved.length > 0 && (
            <>
              {" "}
              {willStage ? "Staging" : "Unstaging"} this also{" "}
              {willStage ? "stages" : "unstages"}{" "}
              {describeAlsoMoved(alsoMoved, staging, profilesByAuthorIds)},
              because they are part of the same change and cannot be published
              separately.
            </>
          )}
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
