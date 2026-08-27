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
});
