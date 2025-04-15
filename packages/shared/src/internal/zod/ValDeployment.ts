import { z } from "zod";

export const ValDeployment = z.object({
  deploymentId: z.string(),
  deploymentState: z.string(),
  commitSha: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
});

export type ValDeployment = z.infer<typeof ValDeployment>;
