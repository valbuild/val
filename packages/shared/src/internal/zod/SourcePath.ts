import { SourcePath as SourcePathT } from "@valbuild/core";
import { z } from "zod";

export const SourcePath: z.ZodType<SourcePathT, z.ZodTypeDef, unknown> = z
  .string()
  .transform((path) => path as SourcePathT);
