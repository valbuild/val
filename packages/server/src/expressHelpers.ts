import { SourcePath } from "@valbuild/core/src/val";

export function getPathFromParams(params: { 0: string }): SourcePath {
  return `/${params[0]}` as SourcePath;
}
