import { SourcePath } from "@valbuild/lib/src/val";

export function getPathFromParams(params: { 0: string }): SourcePath {
  return `/${params[0]}` as SourcePath;
}
