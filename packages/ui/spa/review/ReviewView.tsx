import { useMemo, useRef, useEffect } from "react";
import { GitCompareArrows, Trash2 } from "lucide-react";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import { FieldPatchAuthorsPure } from "../components/FieldPatchAuthors";
import type { Profile } from "../components/ValProvider";
import type { RowStagingState } from "../components/PatchStagingProvider";
import type { ReviewModel, ReviewModuleGroup, ReviewRow } from "./types";

/**
 * What is about to be published, as a list of the things that will go.
 *
 * This is NOT the compare view with the diffs taken out. The two answer
 * different questions and that is why both exist:
 *
 * - `ComparePatchSets` (`/val/compare`) answers **what changed** — every patch
 *   set expanded into its before and after, which is the right shape when you
 *   are checking a value.
 * - This answers **what is going out** — one line per patch set, whose it is,
 *   and whether it is in this publish. Nothing is expanded, because a publish
 *   decision is made over the whole list and a list of diffs cannot be read
 *   whole.
 *
 * The diff is one button away rather than absent: `onCompare` opens the compare
 * dialog over the STAGED set, which is the same question this page is asking,
 * answered in detail.
 *
 * ## One button, not one per row
 *
 * There is deliberately no per-row way into the dialog. A publish ships the
 * staged set as a unit and the thing worth looking at before pressing it is
 * that unit; a per-row dialog would open a one-pane compare whose nav — the
 * dialog's whole asset — had a single entry in it. Per-patch-set granularity is
 * a later decision, once the set-level view has been used.
 */
export function ReviewView({
  model,
  onCompare,
  onStage,
  onUnstage,
  onDiscard,
  onDiscardAll,
}: {
  model: ReviewModel;
  /** Open the compare dialog over what is staged. */
  onCompare: () => void;
  onStage: (rowId: string) => void;
  onUnstage: (rowId: string) => void;
  onDiscard: (rowId: string) => void;
  onDiscardAll: () => void;
}) {
  const rows = useMemo(
    () => model.modules.flatMap((group) => group.rows),
    [model.modules],
  );
  const staged = rows.filter((row) => row.staging !== "held").length;
  const held = rows.length - staged;

  if (rows.length === 0) {
    return <EmptyReview />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-primary px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium text-fg-primary">
            Review changes
          </h1>
          <p className="truncate text-xs text-fg-tertiary">
            {/*
             * Two numbers only when they differ. With nothing held back the
             * second is a subtraction the reader has to do to learn that it is
             * zero, which is the common case and the uninteresting one.
             */}
            {held === 0
              ? `${rows.length} ${rows.length === 1 ? "change" : "changes"} in this publish`
              : `${staged} of ${rows.length} changes in this publish · ${held} held back`}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={onDiscardAll}
            className="text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
          >
            Discard all
          </button>
          {/*
           * The way to the diff, at the top rather than on a row.
           *
           * `secondary`, not the accent: the primary action on this screen is
           * Publish, which the shell owns, and a second filled button beside it
           * would compete with the thing this page exists to lead to.
           */}
          <Button size="sm" variant="secondary" onClick={onCompare}>
            <GitCompareArrows size={13} aria-hidden />
            Compare staged changes
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {model.modules.map((group) => (
          <ModuleGroup
            key={group.moduleFilePath}
            group={group}
            model={model}
            onStage={onStage}
            onUnstage={onUnstage}
            onDiscard={onDiscard}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyReview() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-12">
      <p className="text-sm text-fg-tertiary">
        Nothing is staged. Changes you make show up here before they publish.
      </p>
    </div>
  );
}

function ModuleGroup({
  group,
  model,
  onStage,
  onUnstage,
  onDiscard,
}: {
  group: ReviewModuleGroup;
  model: ReviewModel;
  onStage: (rowId: string) => void;
  onUnstage: (rowId: string) => void;
  onDiscard: (rowId: string) => void;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-1 flex min-w-0 items-baseline gap-2 border-b border-border-secondary pb-1">
        <h2 className="truncate text-sm font-medium text-fg-primary">
          {group.description.title}
        </h2>
        {/*
         * The path beside the name, always. A name can be a preview, which
         * moves as an editor types; the path is how someone finds the file the
         * change is in. Same split as the compare dialog's pane heading.
         */}
        <span className="truncate font-mono text-xs text-fg-tertiary">
          {group.moduleFilePath}
        </span>
      </div>
      {group.rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          model={model}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
        />
      ))}
    </section>
  );
}

function Row({
  row,
  model,
  onStage,
  onUnstage,
  onDiscard,
}: {
  row: ReviewRow;
  model: ReviewModel;
  onStage: (rowId: string) => void;
  onUnstage: (rowId: string) => void;
  onDiscard: (rowId: string) => void;
}) {
  const held = row.staging === "held";
  const named = row.description.origin.title === "preview";
  return (
    <div
      className={cn(
        "group/row flex min-w-0 items-center gap-2 border-b border-border-secondary py-2 last:border-b-0",
        // Held back, not disabled: the row is still readable and still has a
        // Discard button, because a change you are not publishing is exactly
        // the one you may want gone.
        held && "opacity-60",
      )}
    >
      {model.stagingEnabled && (
        <StagingCheckbox
          state={row.staging}
          label={`Include ${row.description.title} in this publish`}
          onToggle={(next) => (next ? onStage(row.id) : onUnstage(row.id))}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {named && (
            <span className="min-w-0 max-w-[45%] shrink truncate text-sm text-fg-primary">
              {row.description.title}
            </span>
          )}
          {/*
           * The path, always — demoted when a name is beside it. It is what
           * tells two rows in one module apart, and what an editor greps for.
           */}
          <span
            className={cn(
              "min-w-0 truncate font-mono text-xs",
              named ? "text-fg-tertiary" : "text-fg-primary",
            )}
          >
            {row.patchPath.length === 0
              ? "the whole module"
              : row.patchPath.join(" › ")}
          </span>
        </div>
        <div className="flex min-w-0 items-baseline gap-2 text-xs text-fg-tertiary">
          <span className="truncate">{row.summary}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {row.patchCount} {row.patchCount === 1 ? "edit" : "edits"}
          </span>
        </div>
        {row.alsoStages !== undefined && row.alsoStages.length > 0 && (
          /*
           * Said on the row rather than at confirm time, because it changes
           * whether you tick the box at all. A later patch set cannot publish
           * without its predecessors — the prefix invariant — so including this
           * row includes somebody else's work, and the names are the part that
           * makes that a decision rather than a surprise.
           */
          <p className="truncate text-xs text-fg-warning-primary">
            {`Also publishes work by ${row.alsoStages.join(", ")}`}
          </p>
        )}
      </div>
      <span className="shrink-0">
        <FieldPatchAuthorsPure
          patchesByAuthorIds={row.authors}
          profilesByAuthorIds={model.profiles as Record<string, Profile>}
          now={model.now}
          portalContainer={null}
          mode="http"
        />
      </span>
      <button
        onClick={() => onDiscard(row.id)}
        aria-label={`Discard ${row.description.title}`}
        /*
         * Always visible, not revealed on hover.
         *
         * The compare dialog hides its row actions until hover because it is a
         * dense diff being READ, and an action on every line would compete with
         * the values. This is a list of decisions, discard is one of the three
         * the page exists for, and `ComparePatchSets` already shows a Discard
         * button per row — a control that only exists once the cursor finds it
         * is not a control an editor knows they have.
         */
        className={cn(
          "shrink-0 rounded p-1 text-fg-tertiary transition-colors",
          "hover:bg-bg-secondary hover:text-fg-error-primary",
        )}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Staged, held, or partly either.
 *
 * `partial` is transient — a patch set is the unit staging moves, so it can
 * only be reached while a change is in flight — but it has to be drawable,
 * because the alternative is a checkbox that reads as one of the two settled
 * states while it is actually neither. `indeterminate` is a DOM property with
 * no HTML attribute, so it goes on through a ref after every render.
 */
function StagingCheckbox({
  state,
  label,
  onToggle,
}: {
  state: RowStagingState;
  label: string;
  onToggle: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = state === "partial";
    }
  }, [state]);
  return (
    <label className="flex shrink-0 cursor-pointer items-center" title={label}>
      <input
        ref={ref}
        type="checkbox"
        checked={state === "staged"}
        onChange={() => onToggle(state !== "staged")}
        aria-label={label}
        aria-checked={state === "partial" ? "mixed" : state === "staged"}
        className="h-3.5 w-3.5 cursor-pointer accent-[var(--bg-brand-primary)]"
      />
    </label>
  );
}
