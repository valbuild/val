import { z } from "zod";

export const ValCommit = z.object({
  commitSha: z.string(),
  /**
   * Where the publisher said it was, or `null` when it did not say.
   *
   * Nullable since the content service mints its own commit shas rather than
   * taking git's: most publishers no longer bake a commit at all, and a root
   * commit -- the first publish of a project with no repository -- has no
   * parent for the same reason.
   */
  clientCommitSha: z.string().nullable(),
  parentCommitSha: z.string().nullable(),
  branch: z.string(),
  creator: z.string(),
  createdAt: z.string(),
  commitMessage: z.string().nullable(),
});

export type ValCommit = z.infer<typeof ValCommit>;
