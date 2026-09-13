import { useEffect, useRef } from "react";
import { AlertTriangle, Undo2, X, Zap } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import type { Profile } from "../components/ValProvider";
import type { UndoSummary } from "./undoSelection";

/**
 * What is about to be undone, and what that drags along.
 *
 * The bar exists mainly for the second half. Selecting a change can force later
 * changes to go with it — the prefix invariant, see `undoSelection.ts` — and
 * the worst outcome available in this whole feature is a click that quietly
 * takes a colleague's edit. So the counts are split: what you chose, and what
 * had to come too, with the people named.
 *
 * It stays visible with nothing selected, saying what mode you are in. A bar
 * that appears on first selection would move the rows under the cursor at the
 * exact moment someone is aiming at a checkbox.
 */
export function CompareUndoBar({
  kind,
  summary,
  pickedCount,
  profiles,
  onCancel,
  onConfirm,
  onRevertAll,
  revertAll,
  portalContainer,
}: {
  kind: "discard" | "revert";
  summary: UndoSummary;
  /** How many rows the user picked themselves, before the closure. */
  pickedCount: number;
  profiles: Record<string, Profile>;
  onCancel: () => void;
  onConfirm: () => void;
  onRevertAll?: () => void;
  /** The whole-commit escape hatch, when this basis has one. */
  revertAll?: {
    label: string;
    blocked?: { moduleFilePath: string; reason: string }[];
  };
  /** Where the blocked-modules popover portals to. */
  portalContainer?: HTMLElement | null;
}) {
  const total = summary.selected.size;
  const pulled = summary.pulledIn.size;
  const verb = kind === "discard" ? "Discard" : "Revert";
  return (
    /*
     * A neutral surface with a brand top-and-bottom rule, not a brand FILL.
     * `bg-bg-brand-secondary` is a near-white mint in dark mode, which both
     * shouts and drops the foreground tokens' contrast — the warning text in
     * particular became unreadable on it. The rules and the button carry the
     * mode; the bar itself only has to be legible.
     */
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-y border-border-brand-primary bg-bg-secondary px-4 py-2">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-primary">
        <Undo2 size={13} aria-hidden />
        {kind === "discard" ? "Discard changes" : "Revert to this version"}
      </span>

      {/*
       * Last and full-width when the bar has to wrap, inline when it does not.
       * Squeezed between the label and the buttons at phone width it broke
       * "Pick what to undo." across two lines and pushed the row to double
       * height; the status line is the one part here that can afford its own
       * row.
       */}
      <span className="order-last w-full min-w-0 text-xs text-fg-secondary sm:order-none sm:w-auto sm:flex-1">
        {total === 0 ? (
          "Pick what to undo."
        ) : (
          <>
            <span className="text-fg-primary">{`${pickedCount} selected`}</span>
            {pulled > 0 && (
              /*
               * Counted apart from the picks, and worded as a requirement
               * rather than a total. "5 selected" would be a true number and a
               * false statement: two of them were chosen and three were
               * compelled, and only the first kind is the user's decision.
               */
              <span className="ml-1 inline-flex items-center gap-1 text-fg-brand-primary">
                <Zap size={11} aria-hidden />
                {`+${pulled} that depend on ${pickedCount === 1 ? "it" : "them"}`}
              </span>
            )}
          </>
        )}
      </span>

      {summary.othersAffected.length > 0 && (
        <span className="flex min-w-0 items-center gap-1 text-xs text-fg-warning-primary">
          <AlertTriangle size={12} className="shrink-0" aria-hidden />
          <span className="truncate">
            {`Includes work by ${summary.othersAffected
              .map((id) => profiles[id]?.fullName ?? id)
              .join(", ")}`}
          </span>
        </span>
      )}

      <span className="flex shrink-0 items-center gap-2">
        {revertAll !== undefined && onRevertAll !== undefined && (
          <span className="flex items-center gap-1.5">
            <button
              onClick={onRevertAll}
              className="text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
            >
              {revertAll.label}
            </button>
            {/*
             * The modules that will be left behind, NAMED.
             *
             * A count told an editor something would not go back without
             * saying what — unactionable at the exact moment they are deciding
             * whether to undo a bad publish. `revertAll` already returns a
             * `RevertPlan.blocked` carrying a reason per module, and this is
             * that list.
             */}
            {revertAll.blocked !== undefined &&
              revertAll.blocked.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1 rounded border border-border-warning-primary px-1.5 py-0.5 text-xs text-fg-warning-primary">
                      <AlertTriangle size={11} aria-hidden />
                      {`${revertAll.blocked.length} cannot`}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    container={portalContainer}
                    align="end"
                    className="z-[9001] w-[320px] p-0"
                  >
                    <div className="border-b border-border-primary px-3 py-2 text-xs font-medium text-fg-secondary">
                      These will not be put back
                    </div>
                    <ul className="flex flex-col gap-2 p-3">
                      {revertAll.blocked.map((entry) => (
                        <li key={entry.moduleFilePath} className="min-w-0">
                          <div className="truncate font-mono text-xs text-fg-primary">
                            {entry.moduleFilePath}
                          </div>
                          <div className="text-xs text-fg-tertiary">
                            {entry.reason}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-border-primary px-3 py-2 text-xs text-fg-tertiary">
                      Everything else in the commit still goes back.
                    </div>
                  </PopoverContent>
                </Popover>
              )}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X size={13} aria-hidden />
          Cancel
        </Button>
        <Button
          size="sm"
          variant={kind === "discard" ? "destructive" : "default"}
          disabled={total === 0}
          onClick={onConfirm}
        >
          {total === 0 ? verb : `${verb} ${total}`}
        </Button>
      </span>
    </div>
  );
}

/** The checkbox a row grows in undo mode. */
export function UndoCheckbox({
  checked,
  pulledIn,
  onToggle,
  label,
}: {
  checked: boolean;
  /** Selected by the closure rather than by the user. */
  pulledIn: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label
      className="flex shrink-0 cursor-pointer items-center"
      title={
        pulledIn
          ? `Required by something else you picked`
          : `Select ${label} to undo`
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={label}
        className={cn(
          "h-3.5 w-3.5 cursor-pointer accent-[var(--bg-brand-primary)]",
          /*
           * A pulled-in row is still a real checkbox rather than a disabled
           * one: unticking it is the way to back out of a closure you did not
           * want, and disabling it would leave that with no gesture at all.
           */
          pulledIn && "opacity-70",
        )}
      />
    </label>
  );
}

/**
 * Why a row cannot be reverted.
 *
 * At the END of the row, not in the checkbox slot: the reason is a sentence
 * about the schema, and putting it where the control goes pushed the field's
 * own name to the right and made the row read reason-first. Sentence case for
 * the same reason — it is prose, not a status badge.
 */
export function UndoBlocked({ reason }: { reason?: string }) {
  return (
    <span
      className="min-w-0 shrink truncate text-xs italic text-fg-tertiary"
      title={reason}
    >
      {reason ?? "Cannot revert"}
    </span>
  );
}

/**
 * The checkbox a nav row or a group heading grows in undo mode.
 *
 * Tri-state, and `indeterminate` is a DOM PROPERTY with no HTML attribute — it
 * cannot be set from JSX, so it goes on through a ref after every render. Two
 * states would lie here: a heading whose list is half selected has to say so,
 * or ticking it looks like it did nothing and unticking it looks like it did
 * too much.
 *
 * Clicking a partially selected box selects the rest rather than clearing it.
 * "Some" reads as an unfinished selection, and finishing it is the likelier
 * intent than abandoning it — and unticking is one more click away either way.
 */
export function UndoAggregateCheckbox({
  state,
  onToggle,
  label,
}: {
  state: "none" | "some" | "all";
  onToggle: (next: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = state === "some";
    }
  }, [state]);
  return (
    <label className="flex shrink-0 cursor-pointer items-center" title={label}>
      <input
        ref={ref}
        type="checkbox"
        checked={state === "all"}
        onChange={() => onToggle(state !== "all")}
        aria-label={label}
        aria-checked={state === "some" ? "mixed" : state === "all"}
        className="h-3.5 w-3.5 cursor-pointer accent-[var(--bg-brand-primary)]"
      />
    </label>
  );
}

/**
 * The gap a non-selectable row leaves where a checkbox would be.
 *
 * Without it the labels of selectable and non-selectable rows start at
 * different x positions, and the checkboxes stop being a column you can run
 * your eye down — which is the only reason they are at the start of the row.
 */
export function UndoSpacer() {
  return <span className="w-3.5 shrink-0" aria-hidden />;
}
