import { Internal, Json, Val } from "@valbuild/core";
import { decodeValPathsOfString } from "./decodeValPathsOfString";
import { ValEncodedString } from "@valbuild/react/stega";

export type ValAttrs = { "data-val-path"?: string };
export function attrs(target: unknown): ValAttrs {
  const allPaths: Set<string> = new Set();
  function addPath(target: unknown) {
    if (typeof target === "string") {
      const paths = decodeValPathsOfString(target as ValEncodedString);
      if (paths) {
        for (const path of paths) {
          allPaths.add(path);
        }
      }
    }
    if (typeof target === "object" && target !== null) {
      const path = Internal.getValPath(target as Val<Json>);
      if (path) {
        allPaths.add(path);
      }
      Object.values(target).forEach(addPath);
    }
  }
  addPath(target);
  if (allPaths.size === 0) {
    return {};
  }
  return {
    "data-val-path": Array.from(allPaths).join(","),
  };
}
