import { z } from "zod";

/**
 * What Val's server reads of content's proposal before a code write at the
 * proposal's address (`beforeProposalCodeWrite` in `ValServer`): its code
 * mode. valbuild/home's code-mode contract, section 1: every `ProposalJson`
 * carries `codeMode`. Absent from content older than code mode, which has no
 * switch to turn.
 */
export const ProposalCodeModeRead = z.object({
  proposal: z.object({
    codeMode: z
      .object({
        on: z.boolean(),
        /** Profile id of who last turned it on or off. */
        changedBy: z.string().nullable(),
        /** ISO time of that. */
        changedAt: z.string().nullable(),
      })
      .optional(),
  }),
});
