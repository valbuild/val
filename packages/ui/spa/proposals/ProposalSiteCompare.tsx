import { useCallback, useMemo } from "react";
import type { SourcePath } from "@valbuild/core";
import { Loader2 } from "lucide-react";
import { CompareDialog } from "../compare/CompareDialog";
import {
  CompareBeforeSourcesContext,
  CompareValue,
} from "../compare/CompareValue";
import { useCompareModel } from "../compare/useCompareModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/designSystem/dialog";
import { useCurrentAuthorId } from "../components/ValProvider";
import type { SiteChanges } from "./useSiteChanges";

/**
 * Compare with the site, in a proposal: what Publish -- merging it -- would
 * change, saved and unsaved alike. valbuild/home `docs/proposals.md`.
 *
 * The same dialog the review page opens, against another basis: the site on
 * the left, the proposal on the right. Read-only, because a saved change is
 * the proposal's and not a patch anyone here could drop.
 */
export function ProposalSiteCompare({
  changes,
  open,
  onOpenChange,
  portalContainer,
}: {
  changes: SiteChanges;
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
              <Loader2 size={14} className="animate-spin" /> Reading the site…
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
      <MountedSiteCompare changes={changes} onOpenChange={onOpenChange} />
    </CompareBeforeSourcesContext.Provider>
  );
}

const NO_PATCH_SETS: never[] = [];

function MountedSiteCompare({
  changes,
  onOpenChange,
}: {
  changes: Extract<SiteChanges, { status: "ready" }>;
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
    />
  );
}
