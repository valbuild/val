import { historyEnabledFor } from "./historyEnabled";

/**
 * The one test both doors to History are behind.
 *
 * `historyAffordance.test.tsx` drives `TopBar` with `historyEnabled` as a
 * boolean prop, so it pins where the button appears and cannot see how the
 * boolean was decided. Deciding it twice is exactly what went wrong: the top
 * bar required a resolved branch and the review page's Restore did not, so a
 * git-less http project hid one and offered the other.
 */
describe("whether this deployment has a history to show", () => {
  test("http with a resolved branch has one", () => {
    expect(historyEnabledFor({ mode: "http", historyBranch: "main" })).toBe(
      true,
    );
  });

  /* `ValOpsFS` answers `not-supported-in-fs-mode`: local dev has git, not a
   * commit archive. A branch name does not change that. */
  test("fs never has one, branch or no branch", () => {
    expect(historyEnabledFor({ mode: "fs", historyBranch: "main" })).toBe(
      false,
    );
    expect(historyEnabledFor({ mode: "fs", historyBranch: null })).toBe(false);
  });

  /* History is listed per branch, so a deployment that names none has
   * nothing to ask for. */
  test("http without a branch does not", () => {
    expect(historyEnabledFor({ mode: "http", historyBranch: null })).toBe(
      false,
    );
  });

  /* Before the mode is known, offering a door that may apologise is the worse
   * of the two mistakes. */
  test("an unknown mode does not", () => {
    expect(historyEnabledFor({ mode: "unknown", historyBranch: "main" })).toBe(
      false,
    );
  });
});
