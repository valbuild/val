import { z } from "zod";

export const Tree = z.object({
  git: z.object({
    commit: z.string(),
    branch: z.string(),
  }),
  modules: z.record(
    z.object({
      // TODO: types!
      schema: z.any().optional(),
      source: z.any().optional(),
      // TODO: patches
    })
  ),
});

export type Tree = z.infer<typeof Tree>;
