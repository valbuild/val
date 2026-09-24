import type { CompareUndoKind } from "./types";

/**
 * What the two undo mechanics are CALLED, in one place.
 *
 * The mechanics are genuinely different and keep their names in the types:
 * `discard` drops a staged patch that was never published, `revert` writes an
 * old value forward as a new change. The words an editor reads are not those
 * words, for two reasons.
 *
 * "Discard" overstates. It is the vocabulary of throwing something away, and it
 * made a mode whose actual promise is "you can put this back the way it was"
 * read as a demolition tool. "Revert" says the same thing about the same
 * mechanic without the alarm.
 *
 * "Revert" against a COMMIT understates in the other direction. Nothing is
 * being undone there — the change already shipped — and what the button does is
 * fetch an old value and stage it as a new change. "Restore" is what that is,
 * and it also says the thing worth knowing: the result is a change like any
 * other, which you can review and revert in turn.
 *
 * ## The trap this leaves
 *
 * `kind: "revert"` is labelled "Restore", and `kind: "discard"` is labelled
 * "Revert". A reader who assumes the discriminant matches the button will get
 * it exactly backwards. That mismatch is the cost of not renaming the
 * discriminants, and it is deliberate for now: the words are still being
 * evaluated, and renaming a discriminant that appears across types, adapters
 * and comments is not a thing to do twice. If the words stick, rename
 * `discard` → `unstage` and `revert` → `restore` and delete this paragraph.
 */
export type UndoWords = {
  /** The verb alone: a row's hover action, and the confirm button. */
  verb: string;
  /** The mode's name: the header button and the bar's label. */
  mode: string;
  /** The mode's name with no room: the header button on a phone. */
  shortMode: string;
  /** The bulk action at the end of the bar. */
  all: string;
  /** What the bar says while nothing is hovered. */
  hint: string;
  /** The reassurance under the hint, when the tone has room for it. */
  reassurance: string;
  /** What the confirmation asks about one change with no dependents. */
  ask: string;
  /** What it asks when the closure compels others. `count` is those others. */
  askWithDependents: (count: number) => string;
};

const WORDS: Record<CompareUndoKind, UndoWords> = {
  discard: {
    verb: "Revert",
    mode: "Revert changes",
    shortMode: "Revert",
    all: "Revert all",
    hint: "Hover a change to put it back the way it was.",
    /*
     * Said because it is the thing that makes this mode safe to open, and the
     * thing nobody can tell by looking: these changes are staged, so reverting
     * one changes nothing that is live. Without it an editor has to guess
     * whether they are editing the site or a draft of it.
     */
    reassurance: "Nothing here is live yet.",
    ask: "Revert this change?",
    askWithDependents: (count) =>
      `Revert this change and ${count} later ${count === 1 ? "one" : "ones"}?`,
  },
  revert: {
    verb: "Restore",
    mode: "Restore from this version",
    shortMode: "Restore",
    all: "Restore all",
    hint: "Hover a change to bring the old value back.",
    /*
     * The restore is itself a staged change, which is the whole reason this
     * mode is not frightening: it goes through the same review and publish as
     * any edit, and can be reverted like one.
     */
    reassurance: "This stages a change you can review before publishing.",
    ask: "Bring the old value back?",
    askWithDependents: (count) =>
      `Bring this and ${count} later ${count === 1 ? "value" : "values"} back?`,
  },
};

export function undoWords(kind: CompareUndoKind): UndoWords {
  return WORDS[kind];
}

/**
 * How loud the mode is allowed to be.
 *
 * `"alarm"` paints the bulk action red in both modes. `"calm"` reserves red for
 * the one action that actually destroys something — reverting staged work,
 * confirmed on a single change — and leaves everything else neutral.
 *
 * The distinction is consequence, not taste. Reverting a staged change throws
 * away work that exists nowhere else. Restoring from a commit WRITES a change:
 * nothing is lost, the result is reviewable, and it can be reverted in turn. A
 * screen that shouts equally at both teaches people to ignore the shouting.
 */
export type UndoTone = "alarm" | "calm";

/**
 * The button variant for an action, given the mode, the tone and the reach.
 *
 * `scope` separates the two buttons that exist: `"one"` is a single change,
 * confirmed in a popover that has already named the consequence; `"all"` is the
 * bar's bulk action, which reaches everything in the publish and is the only
 * thing here that can undo an afternoon in one click.
 */
export function undoButtonVariant(
  kind: CompareUndoKind,
  tone: UndoTone,
  scope: "one" | "all",
): "destructive" | "default" | "secondary" {
  if (tone === "alarm") {
    return kind === "discard" ? "destructive" : "default";
  }
  if (kind === "revert") {
    // Restoring loses nothing. Red here would be a lie.
    return scope === "all" ? "secondary" : "default";
  }
  return scope === "all" ? "secondary" : "destructive";
}
