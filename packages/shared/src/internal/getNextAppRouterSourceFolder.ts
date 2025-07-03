import { ModuleFilePath } from "@valbuild/core";

export function getNextAppRouterSourceFolder(moduleFilePath: ModuleFilePath) {
  if (moduleFilePath.startsWith("/app")) {
    return "/app";
  } else if (moduleFilePath.startsWith("/src/app")) {
    return "/src/app";
  }
  return null;
}
