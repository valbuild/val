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
  /**
   * `e2e/` belongs to Playwright, not jest.
   *
   * Both runners claim `*.spec.ts`, and jest picking up a Playwright spec does
   * not fail in an obvious way — `test.describe`/`page` resolve to nothing jest
   * understands, so the suite dies on an import rather than on an assertion.
   * Run those with `pnpm run test:e2e`.
   */
  testPathIgnorePatterns: ["<rootDir>/e2e/", "/node_modules/"],
};
