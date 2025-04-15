import { z } from "zod";

export const ValCommit = z.object({
  commitSha: z.string(),
  clientCommitSha: z.string(),
  parentCommitSha: z.string(),
  branch: z.string(),
  creator: z.string(),
  createdAt: z.string(),
  commitMessage: z.string().nullable(),
});

export type ValCommit = z.infer<typeof ValCommit>;
