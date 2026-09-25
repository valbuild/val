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
  /**
   * The server cannot publish this project AT ALL, and why.
   *
   * Not a state of this client's changes, which is what everything else here
   * is -- it is a fact about the deployment, true before anything was edited
   * and unchanged by discarding, staging or fixing. That is why it is checked
   * first: every other reason below suggests something the reader could do
   * about it, and offering "fix 3 validation errors" to someone whose
   * deployment cannot publish at all would send them to do work that changes
   * nothing.
   *
   * The server's own words, not a code looked up here: it knows which branch
   * and which repository, and a message assembled on this side could only ever
   * say the generic version. See `PublishRefusal` in `ApiRoutes`.
   */
  publishRefusal: string | null;
  validationErrorCount: number;
  /**
   * Changes the server refused on the last attempt.
   *
   * Information, never a block: see the `ready` state below.
   */
  conflictingChangeCount: number;
  isPublishing: boolean;
  /** Refused by the publish gate itself — see `createSystem`. */
  publishDisabled: boolean;
  /** Saving is automatic, so there is nothing to press. */
  autoPublish: boolean;
  pendingServerSidePatchCount: number;
  /** Writes that have not reached the server yet. */
  pendingClientSidePatchCount: number;
  /**
   * There are patches, but applying them changes nothing.
   *
   * Distinct from `pendingServerSidePatchCount === 0`: there IS work queued, it
   * simply cancels itself out — a field edited and then edited back. Publishing
   * would make a commit with no diff in it, so the button is off; the way out
   * is Discard, which is why the compare view puts it where the changes were.
   */
  netChangesEmpty: boolean;
  /**
   * Pending changes this client is holding BACK — outside its patch group.
   *
   * Distinguishes two states that look identical from `netChangesEmpty` alone,
   * because a held patch is not applied to the scoped source and so leaves it
   * equal to base, exactly as an undone edit does. The button is off either
   * way; what differs is what the reader should do about it. Telling someone
   * their work "has been reverted" and offering Discard, when in fact they held
   * it back on purpose and need only stage it, is the more expensive of the two
   * mistakes: one instruction throws the change away.
   */
  heldChangeCount: number;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function describePublishButton(
  input: PublishButtonInput,
): PublishButtonState {
  const {
    mode,
    publishRefusal,
    validationErrorCount,
    conflictingChangeCount,
    isPublishing,
    publishDisabled,
    autoPublish,
    pendingServerSidePatchCount,
    pendingClientSidePatchCount,
    netChangesEmpty,
    heldChangeCount,
  } = input;
  const saving = mode === "fs";

  /*
   * Before everything: can this server publish at all?
   *
   * `show-errors` would be wrong here and `publish` worse. There is nothing in
   * the content to go and look at, and pressing must not start something that
   * the server is going to refuse -- the whole point of carrying this on
   * `/stat` is that the refusal arrives before the click rather than after a
   * commit message has been typed.
   */
  if (publishRefusal !== null) {
    return {
      kind: "blocked",
      label: saving ? "Save" : "Publish",
      description: publishRefusal,
      reason: publishRefusal,
      action: "none",
    };
  }

  /*
   * Validation errors first, and pressable.
   *
   * These block because publishing them WOULD publish something wrong: content
   * the schema says is invalid. Nothing else in this function gets to disable
   * the button on the content's behalf.
   */
  if (validationErrorCount > 0) {
    const reasons: string[] = [
      `${validationErrorCount} validation ${plural(validationErrorCount, "error", "errors")} to fix.`,
    ];
    if (conflictingChangeCount > 0) {
      reasons.push(conflictNote(conflictingChangeCount));
    }
    return {
      kind: "blocked",
      // The count, because it is the useful part and it fits: "Fix 3" is a
      // number someone can go and work through. Past 9 the exact number stops
      // being one — and a fourth digit would push the button wider than the
      // width every other state is sized to — so it caps at "Fix 9+".
      label: `Fix ${validationErrorCount > 9 ? "9+" : validationErrorCount}`,
      description: "Show the validation errors",
      reason: reasons.join(" "),
      // Pressing it goes to the errors rather than doing nothing.
      action: "show-errors",
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
  /*
   * Only once the writing has settled. Mid-keystroke the chain is a prefix of
   * what the editor has typed, so "the net effect is nothing" is a statement
   * about an unfinished edit — and it flickers the button off and on again
   * while someone retypes a value back to what it was.
   */
  const revertedToNothing = !nothingToSend && !stillWriting && netChangesEmpty;
  const disabled =
    publishDisabled ||
    nothingToSend ||
    stillWriting ||
    revertedToNothing ||
    (saving && autoPublish);

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
            : revertedToNothing
              ? heldChangeCount > 0
                ? `${heldChangeCount} ${plural(heldChangeCount, "change is", "changes are")} held back, so there is nothing to publish. Stage ${plural(heldChangeCount, "it", "them")} in Review to publish.`
                : "Every change has been reverted, so there is nothing to publish. Discard them to clear."
              : null,
      action: "none",
    };
  }

  /*
   * A change the server refused LAST time does not disable the button.
   *
   * It used to: the button became a disabled "Fix errors" that nothing could
   * clear short of discarding the change. But a refusal is a statement about
   * the attempt that got it, not about the next one — the deployment may have
   * caught up with a commit it had not seen, the change it depended on may
   * have shipped — and the server refuses the whole commit when a change does
   * not apply, so pressing again cannot publish anything wrong. The worst it
   * can do is be refused again, and say why. So the button stays pressable,
   * and the refusal is what its tooltip says.
   */
  return {
    kind: "ready",
    label: saving ? "Save" : "Publish",
    description:
      conflictingChangeCount > 0
        ? `${conflictNote(conflictingChangeCount)} ${saving ? "Save" : "Publish"} again to retry.`
        : saving
          ? "Save to disk"
          : "Publish pending changes",
    reason: null,
    action: saving ? "save" : "publish",
  };
}

function conflictNote(conflictingChangeCount: number): string {
  return `The last attempt could not apply ${conflictingChangeCount} ${plural(conflictingChangeCount, "change", "changes")}.`;
}
