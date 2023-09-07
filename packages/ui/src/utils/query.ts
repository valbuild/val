import {
  Internal,
  Json,
  ModulePath,
  SerializedModule,
  Source,
  SourcePath,
} from "@valbuild/core";
import { JsonObject } from "@valbuild/core/src/Json";

export type SelectedPaths = { [key: string]: SelectedPaths } | true;

export function query(
  valModules: SerializedModule[],
  paths: Record<string, SelectedPaths>
) {
  function it(source: Json, path: SelectedPaths): Json {
    if (source === null) {
      return source;
    }
    if (path === true) {
      return source;
    } else {
      if (Array.isArray(source)) {
        return source.map((s) => it(s, path));
      } else if (typeof source === "object") {
        return Object.fromEntries(
          Object.entries(paths).map(([k, v]) => [k, it(source[k], v)])
        );
      }
      return source;
    }
  }
  return Object.entries(paths).flatMap(([modulePath, selectedPaths]) => {
    const module = valModules.find((m) => m.path === modulePath);
    if (!module) {
      return [];
    }
    return [[modulePath, it(module.source, selectedPaths)]];
  });
}
