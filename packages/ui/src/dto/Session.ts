import { z } from "zod";
import { SessionMode } from "./SessionMode";

export const Session = z.object({
  id: z.string(),
  mode: SessionMode,
  full_name: z.string().nullable(),
  username: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
});

export type Session = z.infer<typeof Session>;
