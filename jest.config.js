/** @type {import("jest").Config} */
module.exports = {
  /**
   * Ignore git worktrees checked out inside the repo.
   *
   * Claude Code (and `git worktree add` generally) can place a second checkout
   * under `.claude/worktrees/`, which puts a complete second copy of every
   * workspace package inside the root jest scans. Jest's haste map then sees two
   * packages named `@valbuild/core`, refuses to resolve either, and EVERY suite
   * fails to run with "looked up in the Haste module map... several different
   * files". The failure has nothing to do with the code under test, which makes
   * it a genuinely confusing few minutes.
   */
  modulePathIgnorePatterns: ["<rootDir>/\\.claude/worktrees/"],
};
