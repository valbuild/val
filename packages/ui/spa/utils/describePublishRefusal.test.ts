import { describePublishRefusal } from "./describePublishRefusal";
import type { PatchId, ModuleFilePath } from "@valbuild/core";

/**
 * Every refusal says what it is.
 *
 * The call site used to be an if/else over two reasons, so when the publish gate
 * grew two more they were both reported as "A publish is already in progress" —
 * a message that is not just unhelpful but false.
 */
describe("describePublishRefusal", () => {
  test("validation errors name the modules", () => {
    const said = describePublishRefusal({
      status: "refused",
      reason: "validation-errors",
      modules: ["/a.val.ts" as ModuleFilePath, "/b.val.ts" as ModuleFilePath],
    });
    expect(said.message).toContain("validation errors");
    expect(said.details).toContain("/a.val.ts");
    expect(said.details).toContain("/b.val.ts");
  });

  test("a publish already running says so", () => {
    expect(
      describePublishRefusal({
        status: "refused",
        reason: "already-publishing",
      }).message,
    ).toContain("already in progress");
  });

  test("unsaved changes say nothing was lost", () => {
    const said = describePublishRefusal({
      status: "refused",
      reason: "unsaved-changes",
      patchIds: ["p1" as PatchId],
    });
    expect(said.message).toContain("could not be saved");
    expect(said.details).toContain("no work is lost");
  });

  test("a moved chain asks to try again", () => {
    const said = describePublishRefusal({
      status: "refused",
      reason: "chain-moved",
    });
    expect(said.message).toContain("changed while it was being checked");
    expect(said.details).toContain("Try again");
  });

  /** Every reason gets its own message: none falls through to the default. */
  test("no reason reports another reason's message", () => {
    const messages = [
      describePublishRefusal({
        status: "refused",
        reason: "validation-errors",
        modules: [],
      }).message,
      describePublishRefusal({
        status: "refused",
        reason: "already-publishing",
      }).message,
      describePublishRefusal({
        status: "refused",
        reason: "unsaved-changes",
        patchIds: [],
      }).message,
      describePublishRefusal({ status: "refused", reason: "chain-moved" })
        .message,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});
