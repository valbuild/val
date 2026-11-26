import type { PatchId } from "@valbuild/core";
import { discardFailureNotice } from "./discardFailureNotice";

const A = "a" as PatchId;
const B = "b" as PatchId;
const C = "c" as PatchId;

describe("discardFailureNotice", () => {
  it("says nothing was discarded, and retries all of it", () => {
    expect(
      discardFailureNotice([A, B], {
        message: "Val Build could not be reached.",
        discarded: [],
      }),
    ).toEqual({
      title: "Not discarded",
      description: "Val Build could not be reached.",
      remaining: [A, B],
      action: "retry",
    });
  });

  it("says how many went, and retries only the rest", () => {
    expect(
      discardFailureNotice([A, B, C], {
        message: "Could not delete c.",
        discarded: [A, B],
      }),
    ).toEqual({
      title: "Only 2 of 3 changes were discarded",
      description: "Could not delete c.",
      remaining: [C],
      action: "retry",
    });
  });

  it("offers to cancel the publish that holds what is left", () => {
    expect(
      discardFailureNotice([A, B, C], {
        message: "It is being published right now.",
        publishJobId: "job-1",
        discarded: [A],
      }),
    ).toEqual({
      title: "Being published right now",
      description:
        "1 of 3 changes was discarded. The other 2 are part of a publish that is running. It is being published right now.",
      remaining: [B, C],
      action: "cancel-publish",
    });
  });

  it("names the publish alone when nothing went", () => {
    expect(
      discardFailureNotice([A], {
        message: "It is being published right now.",
        publishJobId: "job-1",
        discarded: [],
      }),
    ).toEqual({
      title: "Being published right now",
      description: "It is being published right now.",
      remaining: [A],
      action: "cancel-publish",
    });
  });
});
