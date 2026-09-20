import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { useNavigation } from "../ValRouter";
import { useAddModuleFilePatch } from "../ValProvider";
import {
  useCreatableRouters,
  useCreateRouteEntry,
} from "../useCreateRouteEntry";
import { ExternalPagesDialog } from "./ExternalPagesDialog";
import { useExternalPages } from "./useExternalPages";
import { useExternalUrlProber } from "./useExternalUrlProber";
import { ShellBreakpoint, ShellExternalPage } from "./types";

export type ConnectedExternalPagesProps = {
  /** The rows as the navigation already knows them: id, url, source path. */
  pages: readonly ShellExternalPage[];
  /** The external router's module, where the entries live. */
  moduleFilePath: ModuleFilePath | undefined;
  breakpoint: ShellBreakpoint;
  portalContainer?: HTMLElement | null;
  onClose: () => void;
  /** Open one URL's entry in the editor. The shell owns selection. */
  onSelectExternalPage: (page: ShellExternalPage) => void;
};

/**
 * The external pages dialog, with the store behind it.
 *
 * A component rather than a hook call in `ValShell`, and that is the whole
 * point of it: the shell renders this only while the dialog is open, so the
 * hooks inside — the reference index over every module in the project, the
 * module's own source — do not run for a Studio nobody has opened it in.
 * Closing it unmounts them again.
 *
 * `onProbe` goes through `/external-urls/check`, because opening a URL cannot
 * be done from a browser: a cross-origin `fetch` cannot read a status without
 * CORS headers no ordinary site sends. The server's side of that is an SSRF
 * surface by construction - see `linkCheck/addressGuard.ts`.
 */
export function ConnectedExternalPages({
  pages,
  moduleFilePath,
  breakpoint,
  portalContainer,
  onClose,
  onSelectExternalPage,
}: ConnectedExternalPagesProps) {
  const { navigate } = useNavigation();
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const { externalRouter } = useCreatableRouters();
  const createRouteEntry = useCreateRouteEntry();
  const enriched = useExternalPages(pages, moduleFilePath, true);
  const onProbe = useExternalUrlProber();

  /**
   * Adding is the same operation the sitemap's Add page performs — the key,
   * plus `emptyOf` the router's item schema — so it goes through the same
   * function rather than building a second patch that has to agree with it.
   *
   * Absent when the router is not creatable, which is what makes the dialog
   * hide the button instead of offering one that cannot work.
   */
  const onAddPage = useCallback(
    (url: string) => {
      if (externalRouter === null) return;
      createRouteEntry(externalRouter, url);
    },
    [externalRouter, createRouteEntry],
  );

  /**
   * Removing is one op, because the record's key IS the URL: there is no
   * separate entry to clean up and no file to release. The dialog does the
   * gating — nothing may link to it, and an unfinished scan is not an answer —
   * and asks before calling this.
   */
  const onRemovePage = useCallback(
    (page: ShellExternalPage) => {
      if (moduleFilePath === undefined) return;
      addModuleFilePatch(
        moduleFilePath,
        [{ op: "remove", path: [page.url] }],
        "record",
      );
    },
    [moduleFilePath, addModuleFilePatch],
  );

  return (
    <ExternalPagesDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      breakpoint={breakpoint}
      pages={enriched}
      portalContainer={portalContainer}
      onOpenEntry={onSelectExternalPage}
      // A usage is a field inside some other module — deeper than any row in
      // the navigation, so it is navigated to directly. Same reason
      // `onOpenSearchResult` exists.
      onOpenUsage={(usage) => navigate(usage.sourcePath)}
      onProbe={onProbe}
      onAddPage={externalRouter === null ? undefined : onAddPage}
      schemes={externalRouter?.schemes}
      onRemovePage={moduleFilePath === undefined ? undefined : onRemovePage}
    />
  );
}
