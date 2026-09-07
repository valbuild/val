import {
  describePublishButton,
  PublishButtonInput,
} from "./publishButtonState";

/**
 * The publish button's six states.
 *
 * The component decided all of this inline, in three separate `return`s that had
 * drifted: only one of them rendered an icon, the disabled reasons were spelled
 * differently, and the blocked state was a dead end — it explained the problem in
 * a tooltip and refused to take you to it, which on a phone left no way at all to
 * reach the thing standing in the way.
 */
function input(over: Partial<PublishButtonInput> = {}): PublishButtonInput {
  return {
    mode: "fs",
    validationErrorCount: 0,
    conflictingChangeCount: 0,
    isPublishing: false,
    publishDisabled: false,
    autoPublish: false,
    pendingServerSidePatchCount: 1,
    pendingClientSidePatchCount: 0,
    netChangesEmpty: false,
    heldChangeCount: 0,
    ...over,
  };
}

describe("describePublishButton", () => {
  test("ready to save, in dev", () => {
    const state = describePublishButton(input());
    expect(state).toMatchObject({
      kind: "ready",
      label: "Save",
      action: "save",
      reason: null,
    });
  });

  test("ready to publish, against a remote", () => {
    const state = describePublishButton(input({ mode: "http" }));
    expect(state).toMatchObject({
      kind: "ready",
      label: "Publish",
      action: "publish",
    });
  });

  test("validation errors take you to them", () => {
    const state = describePublishButton(input({ validationErrorCount: 3 }));
    expect(state.kind).toBe("blocked");
    // The count is the useful part, and it is something to go and work through.
    expect(state.label).toBe("Fix 3");
    expect(state.action).toBe("show-errors");
    expect(state.reason).toContain("3 validation errors");
  });

  test("one error reads as one", () => {
    const state = describePublishButton(input({ validationErrorCount: 1 }));
    expect(state.label).toBe("Fix 1");
    expect(state.reason).toContain("1 validation error to fix");
  });

  test("past nine, the label stops counting", () => {
    // The button is one width in every state: a three-digit count would widen
    // it, and "how many exactly" stops being useful long before that.
    expect(
      describePublishButton(input({ validationErrorCount: 9 })).label,
    ).toBe("Fix 9");
    expect(
      describePublishButton(input({ validationErrorCount: 10 })).label,
    ).toBe("Fix 9+");
    expect(
      describePublishButton(input({ validationErrorCount: 137 })).label,
    ).toBe("Fix 9+");
    // The reason still names the real number — it has room for it.
    expect(
      describePublishButton(input({ validationErrorCount: 137 })).reason,
    ).toContain("137 validation errors");
  });

  test("both blockers are named, not just the first", () => {
    const state = describePublishButton(
      input({ validationErrorCount: 2, conflictingChangeCount: 1 }),
    );
    expect(state.reason).toContain("2 validation errors");
    expect(state.reason).toContain("cannot be applied");
  });

  test("a conflict with no validation error has nowhere to send you", () => {
    // The errors view lists validation errors; a conflicting change is not one.
    const state = describePublishButton(input({ conflictingChangeCount: 2 }));
    expect(state.kind).toBe("blocked");
    expect(state.action).toBe("none");
    expect(state.label).toBe("Fix errors");
  });

  test("in flight says which kind of in flight", () => {
    expect(describePublishButton(input({ isPublishing: true }))).toMatchObject({
      kind: "in-flight",
      label: "Saving",
    });
    expect(
      describePublishButton(input({ isPublishing: true, mode: "http" })),
    ).toMatchObject({ kind: "in-flight", label: "Pushing" });
  });

  test("in flight beats nothing-to-send", () => {
    // The chain empties as the publish lands, and the button must not flip to
    // "idle" mid-flight.
    const state = describePublishButton(
      input({ isPublishing: true, pendingServerSidePatchCount: 0 }),
    );
    expect(state.kind).toBe("in-flight");
  });

  test("errors beat in flight", () => {
    const state = describePublishButton(
      input({ isPublishing: true, validationErrorCount: 1 }),
    );
    expect(state.kind).toBe("blocked");
  });

  test("nothing to send is idle, and says so", () => {
    const state = describePublishButton(
      input({ pendingServerSidePatchCount: 0 }),
    );
    expect(state).toMatchObject({ kind: "idle", action: "none" });
    expect(state.reason).toBe("Nothing to send.");
  });

  test("a write still on its way holds the button", () => {
    const state = describePublishButton(
      input({ pendingClientSidePatchCount: 1 }),
    );
    expect(state.kind).toBe("idle");
    expect(state.reason).toContain("reach the server");
  });

  test("auto save leaves nothing to press, and only in dev", () => {
    expect(describePublishButton(input({ autoPublish: true }))).toMatchObject({
      kind: "idle",
    });
    // Auto save is about writing to disk; a remote publish is still a decision.
    expect(
      describePublishButton(input({ autoPublish: true, mode: "http" })),
    ).toMatchObject({ kind: "ready" });
  });

  describe("when every change has been reverted", () => {
    test("there is nothing to publish, and the reason says how to clear it", () => {
      const state = describePublishButton(
        input({ mode: "http", netChangesEmpty: true }),
      );
      expect(state).toMatchObject({
        kind: "idle",
        label: "Publish",
        action: "none",
      });
      // Not "Nothing to send": there IS something queued. It just cancels out,
      // and Discard is the only way past it now that Publish is off.
      expect(state.reason).toContain("reverted");
      expect(state.reason).toContain("Discard");
    });

    test("but not while an edit is still on its way to the server", () => {
      // Mid-keystroke the chain is a prefix of what has been typed, so "the net
      // effect is nothing" is a claim about an unfinished edit. Acting on it
      // flickers the button off and on again while someone retypes a value.
      const state = describePublishButton(
        input({ netChangesEmpty: true, pendingClientSidePatchCount: 1 }),
      );
      expect(state.reason).toBe(
        "Waiting for the last edit to reach the server.",
      );
    });

    test("validation errors still come first", () => {
      // Both hold at once when a reverted module leaves an unrelated error
      // standing: the error is actionable and the revert is not, so the button
      // stays a pressable "Fix".
      const state = describePublishButton(
        input({ netChangesEmpty: true, validationErrorCount: 2 }),
      );
      expect(state).toMatchObject({ kind: "blocked", label: "Fix 2" });
    });

    test("an empty chain still reads as nothing to send", () => {
      const state = describePublishButton(
        input({ netChangesEmpty: true, pendingServerSidePatchCount: 0 }),
      );
      expect(state.reason).toBe("Nothing to send.");
    });
  });
});

/**
 * Reverted and HELD BACK look identical to every comparison against base — a
 * held patch is not applied, so the scoped source equals base exactly as an
 * undone edit does. The button is off either way, and only the wording tells
 * the reader which of the two they are in.
 *
 * Getting it backwards is the expensive direction: "Every change has been
 * reverted... Discard them to clear" tells someone who deliberately held a
 * change back that their work is gone, and points them at the one control that
 * would actually destroy it.
 */
describe("nothing to publish: reverted against held back", () => {
  const nothingToPublish = {
    netChangesEmpty: true,
    pendingServerSidePatchCount: 1,
  };

  test("an undone edit says reverted, and points at Discard", () => {
    const state = describePublishButton(input(nothingToPublish));
    expect(state.kind).toBe("idle");
    expect(state.reason).toBe(
      "Every change has been reverted, so there is nothing to publish. Discard them to clear.",
    );
  });

  test("a held change says held back, and points at Review", () => {
    const state = describePublishButton(
      input({ ...nothingToPublish, heldChangeCount: 1 }),
    );
    expect(state.kind).toBe("idle");
    expect(state.reason).toBe(
      "1 change is held back, so there is nothing to publish. Stage it in Review to publish.",
    );
    // Never Discard: the change is pending on purpose.
    expect(state.reason).not.toContain("Discard");
  });

  test("more than one held change reads as plural", () => {
    expect(
      describePublishButton(input({ ...nothingToPublish, heldChangeCount: 3 }))
        .reason,
    ).toBe(
      "3 changes are held back, so there is nothing to publish. Stage them in Review to publish.",
    );
  });
});
