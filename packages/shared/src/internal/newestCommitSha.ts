import type { ValCommit } from "./zod/ValCommit";

/**
 * The newest commit the client has been told about, or `null` if none.
 *
 * This is the **publish head**: unlike `baseSha`, which only moves once a
 * deployment lands, it moves the instant somebody publishes. That makes it the
 * one thing a client can carry to `/save` to say "this is the world I decided
 * against" — and the only way the server can tell that somebody else has
 * published since the review screen was read.
 *
 * In `shared` because both sides need the SAME answer: the client names a head
 * and the server compares against one, so two implementations of "newest" is two
 * ways to disagree about whether a publish is stale.
 *
 * By `createdAt` rather than by position, because the list's order is the
 * content API's business and nothing here should depend on it. Ties keep the
 * first seen, which is arbitrary and does not matter: two commits sharing a
 * timestamp are equally "since", and either answer refuses the same publishes.
 */
export function newestCommitSha(
  commits: readonly ValCommit[] | undefined,
): string | null {
  let newest: ValCommit | null = null;
  for (const commit of commits ?? []) {
    if (newest === null || commit.createdAt > newest.createdAt) {
      newest = commit;
    }
  }
  return newest?.commitSha ?? null;
}
