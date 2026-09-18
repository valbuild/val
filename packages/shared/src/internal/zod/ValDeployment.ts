import { z } from "zod";

export const ValDeployment = z.object({
  deploymentId: z.string(),
  deploymentState: z.string(),
  commitSha: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
  /**
   * The commit message, as the deployment's host reported it.
   *
   * Val's OWN publishes carry their message on the commit (`ValCommit`), and
   * that is the one the Studio prefers — it is the message Val wrote. This is
   * for every OTHER deployment: a developer's push, a merged pull request, a
   * revert. Those have no Val commit at all, so without this the deploy feed
   * could only name them by their short sha, and "what went out at 14:02?" had
   * no answer inside the Studio.
   *
   * Optional AND nullable, and the two mean different things: absent is a
   * content service that does not report messages (or an older one), null is
   * one that reports having none. Both render as the short sha, so nothing
   * depends on telling them apart — but a schema that demanded the field would
   * reject the whole deployment feed of a service that does not send it.
   */
  commitMessage: z.string().nullable().optional(),
});

export type ValDeployment = z.infer<typeof ValDeployment>;
