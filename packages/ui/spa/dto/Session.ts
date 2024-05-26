import { ValSession } from "@valbuild/shared/internal";
import { z } from "zod";

export const Session: z.ZodType<ValSession> = z.union([
  z.object({
    id: z.string(),
    mode: z.literal("proxy"),
    full_name: z.string().optional().nullable(),
    username: z.string().optional().nullable(),
    avatar_url: z.string().url().optional().nullable(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("local"),
    enabled: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("unauthorized"),
    enabled: z.boolean().optional(),
  }),
]);

export type Session = z.infer<typeof Session>;
