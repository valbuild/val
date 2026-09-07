import { newestCommitSha } from "./newestCommitSha";
import type { ValCommit } from "./zod/ValCommit";

/**
 * "Which commit is newest" has to have ONE answer.
 *
 * The client names a head and the server compares against one, so two
 * implementations of this are two ways to disagree about whether a publish is
 * stale — a publish silently refused, or silently allowed.
 */

const commit = (commitSha: string, createdAt: string): ValCommit => ({
  commitSha,
  clientCommitSha: commitSha,
  parentCommitSha: "parent",
  branch: "main",
  creator: "someone",
  createdAt,
  commitMessage: null,
});

test("no commits is no head", () => {
  expect(newestCommitSha([])).toBeNull();
  expect(newestCommitSha(undefined)).toBeNull();
});

test("the newest by createdAt wins, whatever the order", () => {
  const older = commit("a", "2026-01-01T00:00:00.000Z");
  const newer = commit("b", "2026-02-01T00:00:00.000Z");
  // By timestamp rather than by position: the list's order is the content
  // API's business and nothing here should depend on it.
  expect(newestCommitSha([older, newer])).toBe("b");
  expect(newestCommitSha([newer, older])).toBe("b");
});

test("a tie keeps the first seen", () => {
  // Arbitrary, and it does not matter: two commits sharing a timestamp are
  // equally "since", so either answer refuses exactly the same publishes.
  const a = commit("a", "2026-01-01T00:00:00.000Z");
  const b = commit("b", "2026-01-01T00:00:00.000Z");
  expect(newestCommitSha([a, b])).toBe("a");
});
