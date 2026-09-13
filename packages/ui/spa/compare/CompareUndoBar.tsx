import { AlertTriangle, Undo2, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import type { Profile } from "../components/ValProvider";
import type { UndoConsequence } from "./undoSelection";
import type { CompareUndoKind } from "./types";
import { undoButtonVariant, undoWords, type UndoTone } from "./undoWords";

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
  onCancel,
  onRevertAll,
  revertAll,
  undoAll,
  tone,
  portalContainer,
}: {
  kind: CompareUndoKind;
  onCancel: () => void;
  onRevertAll?: () => void;
  /** The whole-commit escape hatch, when this basis has one. */
  revertAll?: {
    label: string;
    blocked?: { moduleFilePath: string; reason: string }[];
  };
  /** The whole-publish escape hatch, in place of a batch. */
  undoAll?: { onUndoAll: () => void };
  /** How loud this mode is allowed to be. See `UndoTone`. */
  tone: UndoTone;
  /** Where popovers portal to. */
  portalContainer?: HTMLElement | null;
}) {
  const words = undoWords(kind);
  return (
    /*
     * A neutral surface with a brand top-and-bottom rule, not a brand FILL.
     * `bg-bg-brand-secondary` is a near-white mint in dark mode, which both
     * shouts and drops the foreground tokens\' contrast — the warning text in
     * particular became unreadable on it. The rules and the button carry the
     * mode; the bar itself only has to be legible.
     */
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-y border-border-brand-primary bg-bg-secondary px-4 py-2">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-primary">
        <Undo2 size={13} aria-hidden />
        {words.mode}
      </span>

      {/*
       * Last and full-width when the bar has to wrap, inline when it does not.
       * Squeezed between the label and the buttons at phone width it broke the
       * hint across two lines and pushed the row to double height; the status
       * line is the one part here that can afford its own row.
       */}
      <span className="order-last w-full min-w-0 text-xs text-fg-secondary sm:order-none sm:w-auto sm:flex-1">
        {words.hint}
        {/*
         * The reassurance only in the calm tone, and only because it is the
         * thing that makes the mode safe to open: whether what you are about to
         * change is live. In the alarm tone the red button is making the
         * opposite claim, and printing both would be the screen arguing with
         * itself.
         */}
        {tone === "calm" && (
          <span className="ml-1 text-fg-tertiary">{words.reassurance}</span>
        )}
      </span>

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
        {undoAll !== undefined && (
          <Button
            size="sm"
            variant={undoButtonVariant(kind, tone, "all")}
            onClick={undoAll.onUndoAll}
          >
            {words.all}
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * Why a row cannot be reverted.
 *
 * At the END of the row, where the undo action also lives: the reason is a
 * sentence about the schema, and it takes the place of the control it is
 * explaining the absence of. Sentence case for the same reason — it is prose,
 * not a status badge.
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
 * The undo affordance a row grows when selection is NOT the model.
 *
 * Sanity's Review Changes and Google Docs' suggestion mode both do it this way:
 * no checkbox column, no batch, no running count — each change carries its own
 * action, revealed on hover, confirmed in place. Figma's branch review goes
 * further and offers no per-change undo at all, only an all-or-nothing merge.
 *
 * The argument for it here is density. A checkbox column is paid for by every
 * row on every screen, including the overwhelming majority of visits where
 * nobody undoes anything — and it is paid for twice, because a column of
 * checkboxes only makes sense next to a bar that counts them.
 *
 * What it costs is the thing our checkboxes were for: undoing eleven related
 * changes is eleven hovers and eleven confirmations. That is the trade to look
 * at in the screenshots, not the pixel count.
 *
 * The dependency truth survives the move — it just relocates from a running
 * count in the bar into this popover, said once, about this row, at the moment
 * of the click.
 */
export function RowQuickUndo({
  kind,
  tone,
  consequence,
  profiles,
  onConfirm,
  portalContainer,
}: {
  kind: CompareUndoKind;
  tone: UndoTone;
  /** What goes if this row goes. Computed where the model is. */
  consequence: UndoConsequence;
  profiles: Record<string, Profile>;
  onConfirm: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const words = undoWords(kind);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-opacity",
            "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
          )}
          aria-label={`${words.verb} this change`}
        >
          <Undo2 size={11} className="mr-0.5 inline" aria-hidden />
          {words.verb}
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="z-[9001] w-[280px] p-3"
      >
        <p className="text-xs text-fg-primary">
          {consequence.pulledIn === 0
            ? words.ask
            : words.askWithDependents(consequence.pulledIn)}
        </p>
        {consequence.pulledIn > 0 && (
          /*
           * The same sentence the bar used to carry, said here instead. A later
           * change in the same patch set cannot stay behind once its
           * predecessor goes — see the prefix invariant in `undoSelection.ts` —
           * so this is a consequence, not an option, and it is stated before
           * the button rather than after it.
           */
          <p className="mt-1 text-xs text-fg-tertiary">
            Later changes here were made on top of this one and cannot be kept
            without it.
          </p>
        )}
        {consequence.others.length > 0 && (
          <p className="mt-2 flex items-start gap-1 text-xs text-fg-warning-primary">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {`Includes work by ${consequence.others
                .map((id) => profiles[id]?.fullName ?? id)
                .join(", ")}`}
            </span>
          </p>
        )}
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant={undoButtonVariant(kind, tone, "one")}
            onClick={onConfirm}
          >
            {consequence.ids.length === 1
              ? words.verb
              : `${words.verb} ${consequence.ids.length}`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
