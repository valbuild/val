import { SourcePath } from "@valbuild/core";

// TODO: move this to @valbuild/core and replace createValPathOfItem with this.
export function sourcePathOfItem(
  path: string,
  item: string | number
): SourcePath {
  if (path.includes("?p=")) {
    return (path + "." + JSON.stringify(item)) as SourcePath;
  }
  return (path + "?p=" + JSON.stringify(item)) as SourcePath;
}
