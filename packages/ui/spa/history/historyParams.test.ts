import type { SourcePath } from "@valbuild/core";
import {
  applyHistoryParams,
  clearRestoreTarget,
  enterRestore,
  exitRestore,
  historyParams,
  parseHistoryParams,
  pickRestoreSource,
  pickRestoreTarget,
  type HistoryParams,
} from "./historyParams";

const LEFT = "/content/landing.val.ts?p=/heading" as SourcePath;
const RIGHT = "/content/landing.val.ts?p=/cta" as SourcePath;

const states: HistoryParams[] = [
  { commitSha: null, locked: true, rightPath: null, restore: { mode: "off" } },
  {
    commitSha: "a3f19c2",
    locked: true,
    rightPath: null,
    restore: { mode: "off" },
  },
  {
    commitSha: "a3f19c2",
    locked: false,
    rightPath: RIGHT,
    restore: { mode: "off" },
  },
  {
    commitSha: "a3f19c2",
    locked: true,
    rightPath: null,
    restore: { mode: "picking-source" },
  },
  {
    commitSha: "a3f19c2",
    locked: true,
    rightPath: null,
    restore: { mode: "picking-target", from: RIGHT },
  },
  {
    commitSha: "a3f19c2",
    locked: false,
    rightPath: RIGHT,
    restore: { mode: "confirming", from: RIGHT, to: LEFT },
  },
];

describe("history params", () => {
  test("every stage of a restore survives being a link", () => {
    // The whole reason this state is in the URL: a restore in progress has to
    // be shareable and reloadable, at every step.
    for (const state of states) {
      expect(parseHistoryParams(historyParams(state))).toEqual(state);
    }
  });

  test("params the studio owns are left alone", () => {
    const params = new URLSearchParams("p=/heading&session=abc");
    applyHistoryParams(params, states[1]);
    expect(params.get("p")).toBe("/heading");
    expect(params.get("session")).toBe("abc");
    expect(params.get("commit")).toBe("a3f19c2");
  });

  test("leaving history clears everything it put there", () => {
    const params = historyParams(states[5]);
    applyHistoryParams(params, states[0]);
    expect(params.toString()).toBe("");
  });

  describe("URLs that do not make sense", () => {
    test("restore without a commit is not restore: there is nothing to restore from", () => {
      expect(
        parseHistoryParams(
          "restore=1&restore-from=" + encodeURIComponent(RIGHT),
        ).restore,
      ).toEqual({ mode: "off" });
    });

    test("a target with no source drops back to picking a source", () => {
      const res = parseHistoryParams(
        "commit=a3f19c2&restore=1&restore-to=" + encodeURIComponent(LEFT),
      );
      expect(res.restore).toEqual({ mode: "picking-source" });
    });

    test("a right path while locked is ignored — the left path is both", () => {
      const res = parseHistoryParams(
        "commit=a3f19c2&hp=" + encodeURIComponent(RIGHT),
      );
      expect(res.locked).toBe(true);
      expect(res.rightPath).toBe(null);
    });

    test("locked is the default, so an old link without it still locks", () => {
      expect(parseHistoryParams("commit=a3f19c2").locked).toBe(true);
    });
  });

  describe("transitions", () => {
    const base = states[1];

    test("picking a source, then a target", () => {
      const picked = pickRestoreTarget(
        pickRestoreSource(enterRestore(base), RIGHT),
        LEFT,
      );
      expect(picked.restore).toEqual({
        mode: "confirming",
        from: RIGHT,
        to: LEFT,
      });
    });

    test("changing the source drops the target", () => {
      // The target was chosen because it was compatible with the old source.
      // Keeping it would carry a decision nobody re-checked.
      const confirming = pickRestoreTarget(
        pickRestoreSource(enterRestore(base), RIGHT),
        LEFT,
      );
      const again = pickRestoreSource(confirming, LEFT);
      expect(again.restore).toEqual({ mode: "picking-target", from: LEFT });
    });

    test("a target cannot be picked before a source", () => {
      expect(pickRestoreTarget(enterRestore(base), LEFT).restore).toEqual({
        mode: "picking-source",
      });
    });

    test("clearing the target keeps the source", () => {
      const confirming = pickRestoreTarget(
        pickRestoreSource(enterRestore(base), RIGHT),
        LEFT,
      );
      expect(clearRestoreTarget(confirming).restore).toEqual({
        mode: "picking-target",
        from: RIGHT,
      });
    });

    test("leaving restore keeps the commit you were looking at", () => {
      const left = exitRestore(pickRestoreSource(enterRestore(base), RIGHT));
      expect(left).toEqual(base);
    });
  });
});
