/**
 * What the publish button is, right now.
 *
 * Pulled out of the component because the button has six states across two
 * modes, each with its own label, its own accessible description, its own icon
 * and its own idea of what a click should do — and the component was deciding
 * all of that inline, in three separate `return`s that had drifted: only one of
 * them had an icon, the disabled reasons were spelled differently, and the
 * error state was a dead end.
 *
 * `kind` is what the presentation switches on; everything else is words.
 */
export type PublishButtonKind =
  /** Something must be fixed before this can be pressed at all. */
  | "blocked"
  /** In flight: saving to disk, or pushing to the remote. */
  | "in-flight"
  /** Ready to go, and there is something to send. */
  | "ready"
  /** Nothing to send, or sending is not ours to do right now. */
  | "idle";

export type PublishButtonState = {
  kind: PublishButtonKind;
  /** On the button. */
  label: string;
  /** What pressing it does, for a tooltip and for an icon-only name. */
  description: string;
  /** Why it cannot be pressed, when that is the case. */
  reason: string | null;
  /**
   * What a press should do.
   *
   * `show-errors` is the one that was missing: the blocked button explained the
   * problem in a tooltip and then refused to take you to it, which on a phone —
   * where there is no hover and the errors button is behind a panel — left no
   * way to reach the thing standing in the way.
   */
  action: "publish" | "save" | "show-errors" | "none";
};

export type PublishButtonInput = {
  /** `fs` saves to disk; anything else pushes to a remote. */
  mode: "fs" | "http" | "unknown";
  validationErrorCount: number;
  /** Changes the server will refuse: they have to be discarded first. */
  conflictingChangeCount: number;
  isPublishing: boolean;
  /** Refused by the publish gate itself — see `createSystem`. */
  publishDisabled: boolean;
  /** Saving is automatic, so there is nothing to press. */
  autoPublish: boolean;
  pendingServerSidePatchCount: number;
  /** Writes that have not reached the server yet. */
  pendingClientSidePatchCount: number;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function describePublishButton(
  input: PublishButtonInput,
): PublishButtonState {
  const {
    mode,
    validationErrorCount,
    conflictingChangeCount,
    isPublishing,
    publishDisabled,
    autoPublish,
    pendingServerSidePatchCount,
    pendingClientSidePatchCount,
  } = input;
  const saving = mode === "fs";

  /*
   * Errors first, and pressable.
   *
   * Both reasons can hold at once and each is separately actionable, so the
   * reason names every one that applies rather than only the first.
   */
  if (validationErrorCount > 0 || conflictingChangeCount > 0) {
    const reasons: string[] = [];
    if (validationErrorCount > 0) {
      reasons.push(
        `${validationErrorCount} validation ${plural(validationErrorCount, "error", "errors")} to fix.`,
      );
    }
    if (conflictingChangeCount > 0) {
      reasons.push(
        `${conflictingChangeCount} ${plural(conflictingChangeCount, "change", "changes")} cannot be applied. Remove ${plural(conflictingChangeCount, "it", "them")} to continue.`,
      );
    }
    return {
      kind: "blocked",
      // The count, because it is the useful part and it fits: "Fix 3" is a
      // number someone can go and work through.
      label:
        validationErrorCount > 0 ? `Fix ${validationErrorCount}` : "Fix errors",
      description:
        validationErrorCount > 0
          ? "Show the validation errors"
          : "Show the changes that cannot be applied",
      reason: reasons.join(" "),
      // Pressing it goes to the errors rather than doing nothing.
      action: validationErrorCount > 0 ? "show-errors" : "none",
    };
  }

  if (isPublishing) {
    return {
      kind: "in-flight",
      label: saving ? "Saving" : "Pushing",
      description: saving ? "Saving changes to disk" : "Pushing changes",
      reason: null,
      action: "none",
    };
  }

  const nothingToSend = pendingServerSidePatchCount === 0;
  const stillWriting = pendingClientSidePatchCount > 0;
  const disabled =
    publishDisabled || nothingToSend || stillWriting || (saving && autoPublish);

  if (disabled) {
    return {
      kind: "idle",
      label: saving ? "Save" : "Publish",
      description: saving ? "Save to disk" : "Publish pending changes",
      reason: stillWriting
        ? "Waiting for the last edit to reach the server."
        : saving && autoPublish
          ? "Auto save is on: changes are saved for you."
          : nothingToSend
            ? "Nothing to send."
            : null,
      action: "none",
    };
  }

  return {
    kind: "ready",
    label: saving ? "Save" : "Publish",
    description: saving ? "Save to disk" : "Publish pending changes",
    reason: null,
    action: saving ? "save" : "publish",
  };
}
