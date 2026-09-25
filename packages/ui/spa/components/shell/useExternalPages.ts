import { useMemo } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useAllSources, useSchemas } from "../ValFieldProvider";
import { useRouteReferenceIndex } from "../useRouteReferences";
import { referencesTo } from "../getRouteReferences";
import { enrichExternalPages, externalItemSchema } from "./externalPageDetails";
import { ShellExternalPage } from "./types";

/**
 * The external pages, with what is behind each URL and who links to it.
 *
 * Kept out of `useShellData` on purpose. Everything there is built whenever the
 * Studio renders, because the navigation needs it; this is built only while the
 * dialog is open, because nothing else asks. `enabled` is the switch, and it is
 * what makes the reference index lazy - see `useRouteReferenceIndex`.
 *
 * Takes the base rows rather than deriving them, so `toExternalPages` stays the
 * one place the record's keys become rows and this stays the one place they are
 * enriched.
 */
export function useExternalPages(
  pages: readonly ShellExternalPage[],
  moduleFilePath: ModuleFilePath | undefined,
  enabled: boolean,
): ShellExternalPage[] {
  const schemas = useSchemas();
  const allSources = useAllSources();
  const { index, scan } = useRouteReferenceIndex(enabled);

  const moduleSchema =
    moduleFilePath !== undefined && "data" in schemas
      ? schemas.data?.[moduleFilePath]
      : undefined;
  const moduleSource =
    moduleFilePath !== undefined ? allSources[moduleFilePath] : undefined;

  return useMemo(() => {
    if (!enabled) {
      return [];
    }
    const lookup = (url: string): SourcePath[] => referencesTo(index, url);
    return enrichExternalPages(
      pages,
      moduleFilePath,
      externalItemSchema(moduleSchema),
      moduleSource,
      lookup,
      scan.status === "success",
    );
  }, [
    enabled,
    pages,
    moduleFilePath,
    moduleSchema,
    moduleSource,
    index,
    scan.status,
  ]);
}
