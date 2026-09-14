import { ModuleFilePath as ModuleFilePathT } from "@valbuild/core";
import { z } from "zod";

export const ModuleFilePath: z.ZodType<ModuleFilePathT> = z
  .string()
  .transform((path) => path as ModuleFilePathT);
