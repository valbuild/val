import type { ProposalCodeState, StudioLocation } from "./types";
import { buildIsDue, nextProposalAction, previewUpdateOf } from "./ProposalBar";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;

const at = (code: ProposalCodeState | null): InProposal => ({
  kind: "proposal",
  proposal: {
    name: "a1",
    displayName: "Spring",
    description: null,
    status: "open",
    owner: null,
    ownedByViewer: true,
    changes: 1,
    updatedAt: "2026-10-06T12:00:00Z",
  },
  unsaved: 0,
  save: { state: "idle" },
  overlay: null,
  renderCheck: null,
  publishBlockedBy: null,
  code,
});

describe("previewUpdateOf", () => {
  test("every step that makes a preview is one update", () => {
    expect(previewUpdateOf(null).state).toBe("up-to-date");
    expect(previewUpdateOf({ state: "required" }).state).toBe("behind");
    expect(
      previewUpdateOf({ state: "lockfile", computing: false, error: null })
        .state,
    ).toBe("behind");
    expect(
      previewUpdateOf({ state: "lockfile", computing: true, error: null })
        .state,
    ).toBe("updating");
    expect(previewUpdateOf({ state: "dependencies-building" }).state).toBe(
      "updating",
    );
    expect(previewUpdateOf({ state: "building" }).state).toBe("updating");
  });

  test("a failure says whether trying again can help", () => {
    expect(previewUpdateOf({ state: "failed", error: "x" })).toEqual({
      state: "failed",
      error: "x",
      canRetry: true,
    });
    expect(
      previewUpdateOf({ state: "lockfile", computing: false, error: "stale" }),
    ).toEqual({ state: "failed", error: "stale", canRetry: true });
    const packages = previewUpdateOf({
      state: "dependencies-failed",
      error: null,
    });
    expect(packages.state === "failed" && packages.canRetry).toBe(false);
    expect(buildIsDue({ state: "dependencies-failed", error: null })).toBe(
      false,
    );
  });
});

describe("nextProposalAction, when Save updates the preview", () => {
  test("Save until the preview is up to date, packages included", () => {
    expect(
      nextProposalAction(
        at({ state: "lockfile", computing: false, error: null }),
        true,
        true,
      ),
    ).toBe("save");
    expect(
      nextProposalAction(at({ state: "dependencies-building" }), true, true),
    ).toBe("save");
    expect(nextProposalAction(at(null), true, true)).toBe("publish");
  });

  test("a failed update is never Save's: Save cannot fix it", () => {
    expect(buildIsDue({ state: "failed", error: "x" })).toBe(false);
    expect(
      nextProposalAction(at({ state: "failed", error: "x" }), true, true),
    ).toBe("publish");
    expect(
      nextProposalAction(
        at({ state: "dependencies-failed", error: null }),
        true,
        true,
      ),
    ).toBe("publish");
  });

  test("without it, the packages are still a Build step", () => {
    expect(
      nextProposalAction(
        at({ state: "lockfile", computing: false, error: null }),
        true,
      ),
    ).toBe("build");
  });
});
