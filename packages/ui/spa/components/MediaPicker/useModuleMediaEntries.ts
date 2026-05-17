import { useCallback } from "react";
import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useSourceAtPath, useFilePatchIds } from "../ValFieldProvider";
import { refToUrl } from "./refToUrl";

const EMPTY_MODULE_PATH = "" as SourcePath;

export function useModuleMediaEntries(modulePath: ModuleFilePath | undefined) {
  const source = useSourceAtPath(modulePath ?? EMPTY_MODULE_PATH);
  const filePatchIds = useFilePatchIds();

  const getUrl = useCallback(
    (filePath: string): string => refToUrl(filePath, filePatchIds),
    [filePatchIds],
  );

  if (!modulePath || source.status !== "success") {
    return { moduleEntries: undefined, getUrl, ready: false as const };
  }

  const moduleEntries = {
    [modulePath]: source.data as Record<string, Record<string, unknown>>,
  };
  return { moduleEntries, getUrl, ready: true as const };
}
