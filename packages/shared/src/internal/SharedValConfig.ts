import { ValConfig } from "@valbuild/core";
import { z } from "zod";

export const SharedValConfig: z.ZodSchema<
  ValConfig & {
    // We are adding URLs and other server only config options here
    contentHostUrl?: string;
  }
> = z.object({
  contentHostUrl: z.string().optional(),
  project: z.string().optional(),
  root: z.string().optional(),
  files: z
    .object({
      directory: z.literal("/public/val"),
    })
    .optional(),
  gitCommit: z.string().optional(),
  gitBranch: z.string().optional(),
  defaultTheme: z.enum(["dark", "light"]).optional(),
  ai: z
    .object({
      commitMessages: z
        .object({
          disabled: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * Config that is shared between the client and server.
 */
export type SharedValConfig = z.infer<typeof SharedValConfig>;
