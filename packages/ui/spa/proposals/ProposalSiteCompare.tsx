import { useCallback, useMemo } from "react";
import type { SourcePath } from "@valbuild/core";
import { CompareDialog } from "../compare/CompareDialog";
import {
  CompareBeforeSourcesContext,
  CompareValue,
} from "../compare/CompareValue";
import { useCompareModel } from "../compare/useCompareModel";
import type { ComparePageView } from "../compare/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/designSystem/dialog";
import { useCurrentAuthorId } from "../components/ValProvider";
import type { SiteChanges } from "./useSiteChanges";
import { Spinner } from "../components/designSystem/spinner";
import { ProposalPage } from "./ProposalPageCompare";
import { siteOrigin } from "./sitePageUrl";

/**
 * Compare with the site, in a proposal: what Publish -- merging it -- would
 * change, saved and unsaved alike. valbuild/home `docs/proposals.md`.
 *
 * The same dialog the review page opens, against another basis: the site on
 * the left, the proposal on the right. Read-only, because a saved change is
 * the proposal's and not a patch anyone here could drop.
 *
 * A page can be compared as a page, too: the site's render beside the
 * proposal's, once the site's address is known. See `ProposalPage`.
 */
export function ProposalSiteCompare({
  changes,
  siteUrl,
  open,
  onOpenChange,
  portalContainer,
}: {
  changes: SiteChanges;
  /** Where the site is served; null until the proposals list has said. */
  siteUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
}) {
  if (!open || changes.status === "off") return null;
  if (changes.status !== "ready") {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          container={portalContainer}
          className="max-w-sm gap-2 border-border-float bg-bg-float p-5"
        >
          <DialogTitle className="text-sm font-semibold">
            Compare with the site
          </DialogTitle>
          {changes.status === "loading" ? (
            <DialogDescription className="flex items-center gap-2 text-xs text-fg-secondary">
              <Spinner size={14} /> Reading the site…
            </DialogDescription>
          ) : (
            <>
              <DialogDescription
                role="alert"
                className="text-xs text-fg-error-on-surface"
              >
                {changes.message}
              </DialogDescription>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={changes.retry}
                  className="h-8 rounded-md border border-border-float px-3 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
                >
                  Try again
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <CompareBeforeSourcesContext.Provider value={changes.siteSources}>
      <MountedSiteCompare
        changes={changes}
        siteUrl={siteUrl}
        onOpenChange={onOpenChange}
      />
    </CompareBeforeSourcesContext.Provider>
  );
}

const NO_PATCH_SETS: never[] = [];

function MountedSiteCompare({
  changes,
  siteUrl,
  onOpenChange,
}: {
  changes: Extract<SiteChanges, { status: "ready" }>;
  siteUrl: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const currentAuthorId = useCurrentAuthorId();
  const renderValue = useCallback(
    (path: SourcePath, side: "before" | "after") => (
      <CompareValue path={path} side={side} />
    ),
    [],
  );
  const site = useMemo(() => ({ trees: changes.trees }), [changes.trees]);
  /*
   * Without the site's address there is no left page, and one side of a
   * comparison is not one. Nor with an address that is not a whole URL: the
   * side would resolve it against THIS origin, and show the proposal under a
   * heading that says the site.
   */
  const renderPage = useMemo(
    () =>
      siteUrl === null || siteOrigin(siteUrl) === null
        ? undefined
        : (page: ComparePageView) => (
            <ProposalPage siteUrl={siteUrl} page={page} />
          ),
    [siteUrl],
  );
  const { model } = useCompareModel({
    patchSets: NO_PATCH_SETS,
    mode: "http",
    renderValue,
    site,
  });
  return (
    <CompareDialog
      open
      onOpenChange={onOpenChange}
      model={model}
      mode="http"
      currentAuthorId={currentAuthorId}
      renderPage={renderPage}
    />
  );
}
