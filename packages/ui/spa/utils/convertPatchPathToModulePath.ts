import { ModulePath } from "@valbuild/core";

export function convertPatchPathToModulePath(patchPath: string[]): ModulePath {
  // This is slightly wrong since the module path differentiates between array path segments (number for module path, string for module path)
  // We need the schema to know which is which
  // This was written for the prototyping so it didn't matter...
  // If this ends up in production, we should probably fix that...
  return patchPath.map((seg) => `"${seg}"`).join(".") as ModulePath;
}
