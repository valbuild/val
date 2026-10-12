import type { DependencyChange } from "@valbuild/shared/internal";
import {
  badgeText,
  quickActionsLabel,
  siteUpdateActionLabel,
  siteUpdateIndicator,
  summarizeChanges,
  valReleaseUrl,
} from "./siteUpdateIndicator";
import { stageOfPercent, stageOfPhase } from "../../publish/useSiteUpdate";
import { deployPercent } from "../../publish/deployProgress";

const change = (
  name: string,
  from: string | null,
  to: string | null,
  section: DependencyChange["section"] = "dependencies",
): DependencyChange => ({ name, section, from, to });

describe("the site update's badge", () => {
  test("is nothing while there is nothing anyone can do", () => {
    expect(siteUpdateIndicator({ status: "checking" })).toBeNull();
    expect(siteUpdateIndicator({ status: "current" })).toBeNull();
    expect(
      siteUpdateIndicator({ status: "unavailable", message: "no" }),
    ).toBeNull();
    // A failed CHECK is said in Settings, where Check again is: a badge for
    // "we could not ask" is one nobody can clear.
    expect(
      siteUpdateIndicator({ status: "check-failed", message: "offline" }),
    ).toBeNull();
  });

  test("counts the packages that move", () => {
    expect(
      siteUpdateIndicator({
        status: "available",
        changes: [
          change("@valbuild/core", "1.0.0", "1.1.0"),
          change("zod", "3.0.0", "4.0.0"),
        ],
      }),
    ).toEqual({ kind: "count", count: 2 });
  });

  test("is a dot for an update that moves no version", () => {
    expect(siteUpdateIndicator({ status: "available", changes: [] })).toEqual({
      kind: "dot",
    });
  });

  test("follows the update through to the reload", () => {
    expect(
      siteUpdateIndicator({ status: "updating", step: "Building" }),
    ).toEqual({ kind: "busy" });
    expect(siteUpdateIndicator({ status: "blocked" })).toEqual({
      kind: "attention",
    });
    expect(
      siteUpdateIndicator({ status: "failed", message: "x", details: "" }),
    ).toEqual({ kind: "attention" });
    expect(siteUpdateIndicator({ status: "updated", changes: [] })).toEqual({
      kind: "dot",
    });
  });

  test("past nine, says 9+ as the bell does", () => {
    expect(badgeText(9)).toBe("9");
    expect(badgeText(12)).toBe("9+");
  });

  test("puts what the badge says in the button's name", () => {
    expect(quickActionsLabel(null)).toBe("Quick actions");
    expect(quickActionsLabel({ kind: "count", count: 1 })).toBe(
      "Quick actions (1 update available)",
    );
    expect(quickActionsLabel({ kind: "count", count: 12 })).toBe(
      "Quick actions (12 updates available)",
    );
  });
});

describe("the quick action's label", () => {
  test("is Show updates while one is available, and not offered otherwise", () => {
    expect(siteUpdateActionLabel({ status: "available", changes: [] })).toBe(
      "Show updates",
    );
    expect(siteUpdateActionLabel({ status: "current" })).toBeNull();
  });

  test("carries the progress while the update runs", () => {
    expect(
      siteUpdateActionLabel({ status: "updating", step: "Building" }),
    ).toBe("Updating site…");
    expect(
      siteUpdateActionLabel({
        status: "updating",
        step: "Building",
        percent: 40,
      }),
    ).toBe("Updating site · 40%");
  });
});

describe("what the dialog names", () => {
  test("is Val as one line, from core, and everything else folded, runtime first", () => {
    const summary = summarizeChanges([
      change("typescript", "5.8.3", "5.9.2", "devDependencies"),
      change("@valbuild/tanstack", "0.142.0", "0.145.0"),
      change("@valbuild/core", "0.142.0", "0.145.0"),
      change("zod", "3.24.1", "4.1.0"),
    ]);
    expect(summary.val).toEqual({ from: "0.142.0", to: "0.145.0" });
    expect(summary.others.map((c) => c.name)).toEqual(["zod", "typescript"]);
  });

  test("has no Val line when Val does not move", () => {
    expect(summarizeChanges([change("zod", "3.0.0", "4.0.0")]).val).toBeNull();
  });

  test("links a Val version to its release, and nothing else", () => {
    expect(valReleaseUrl("0.145.0")).toBe(
      "https://github.com/valbuild/val/releases/tag/%40valbuild%2Fcore%400.145.0",
    );
    expect(valReleaseUrl("^0.145.0")).toBe(valReleaseUrl("0.145.0"));
    expect(valReleaseUrl(">=0.1")).toBeNull();
    expect(valReleaseUrl("latest")).toBeNull();
    expect(valReleaseUrl(null)).toBeNull();
  });
});

describe("which of the three steps a deploy is on", () => {
  test("from its phase: everything before the canary render is the rebuild", () => {
    expect(stageOfPhase("building")).toBe("rebuilding");
    expect(stageOfPhase("uploading")).toBe("rebuilding");
    expect(stageOfPhase("verifying")).toBe("checking");
    expect(stageOfPhase("promoting")).toBe("going-live");
  });

  test("from a builder tab's percent, agreeing with the phase", () => {
    for (const kind of ["building", "verifying", "promoting"] as const) {
      expect(stageOfPercent(deployPercent({ kind }))).toBe(stageOfPhase(kind));
    }
  });
});
