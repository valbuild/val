import { ownPublishCard } from "./ownPublishCard";
import type { PublishJobsState, TrackedPublish } from "./publishJobs";

const press = (over: Partial<TrackedPublish> = {}): TrackedPublish => ({
  requestId: "r1",
  pressedAt: 1_000,
  status: { kind: "publishing" },
  ...over,
});

const stateOf = (...requests: TrackedPublish[]): PublishJobsState => ({
  requests,
  running: null,
});

describe("the overlay's card for a publish the page made itself", () => {
  test("says nothing before a press", () => {
    expect(ownPublishCard(stateOf(), new Set())).toBeNull();
  });

  test("says it is publishing while it is", () => {
    expect(ownPublishCard(stateOf(press()), new Set())?.card).toEqual({
      kind: "publishing",
    });
    expect(
      ownPublishCard(stateOf(press({ status: { kind: "queued" } })), new Set())
        ?.card,
    ).toEqual({ kind: "publishing" });
  });

  test("says it is live, and after how long", () => {
    const live = press({
      status: { kind: "live", commit: "c1" },
      settledAt: 4_500,
    });
    expect(ownPublishCard(stateOf(live), new Set())?.card).toEqual({
      kind: "live",
      ms: 3_500,
      followed: true,
    });
  });

  test("says why it failed", () => {
    const failed = press({
      status: {
        kind: "failed",
        message: "The build failed.",
        actions: ["try-again"],
        job: "J1",
      },
    });
    expect(ownPublishCard(stateOf(failed), new Set())?.card).toEqual({
      kind: "failed",
      message: "The build failed.",
      followed: true,
    });
  });

  test("asks for a builder tab when its job needs a build after all", () => {
    expect(
      ownPublishCard(stateOf(press({ needsBuilder: true })), new Set())?.card,
    ).toEqual({ kind: "needs-builder" });
  });

  test("leaves a press a builder tab made to that tab's card", () => {
    expect(ownPublishCard(stateOf(press({ viaTab: true })), new Set())).toBe(
      null,
    );
  });

  test("is gone once dismissed, and for nothing to publish", () => {
    expect(ownPublishCard(stateOf(press()), new Set(["r1"]))).toBeNull();
    expect(
      ownPublishCard(
        stateOf(press({ status: { kind: "nothing-to-publish" } })),
        new Set(),
      ),
    ).toBeNull();
  });

  test("follows the newest press", () => {
    const older = press({
      requestId: "r0",
      status: { kind: "live", commit: "c" },
    });
    expect(ownPublishCard(stateOf(older, press()), new Set())?.requestId).toBe(
      "r1",
    );
  });
});
