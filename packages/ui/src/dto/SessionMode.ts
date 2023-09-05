import { z } from "zod";

export const SessionMode = z.union([z.literal("local"), z.literal("proxy")]);

export type SessionMode = z.infer<typeof SessionMode>;
