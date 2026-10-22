import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { INTENT_MAX_AGE_MS } from "../publish/handoff";
import { createProposalsClient } from "../proposals/proposalsClient";
import { waitForAddress } from "../proposals/useProposals";
import { cn } from "../components/designSystem/cn";
import { upgradeDisplayName, type UpgradePath } from "./upgradesClient";
import { upgradeTabUrl } from "./upgradeTab";

const STALE_MESSAGE =
  "This upgrade was asked for over an hour ago and never started, so nothing was made. Press Upgrade in the Studio to start it now.";

/**
 * The upgrade tab's first page (`start-upgrade` in `HandoffIntent`), at the
 * site's address: it creates the upgrade proposal the tap asked for and goes
 * to the proposal's address as its upgrade tab, which does the rest.
 *
 * The tab, not the page that opened it, because on an iPhone the tab takes
 * the screen and the page behind it is paused: a create the page started
 * would wait until someone went back to it. Created under the tap's
 * `requestId`, so Try again -- or the tab opened again -- makes the same
 * proposal rather than a second one.
 */
export function StartUpgradeTab({
  path,
  skip,
  requestId,
  at,
}: {
  path: UpgradePath;
  skip: string[];
  requestId: string;
  /** When the tap was. */
  at: number;
}) {
  const stale = Date.now() - at > INTENT_MAX_AGE_MS;
  const [failed, setFailed] = useState<string | null>(
    stale ? STALE_MESSAGE : null,
  );
  const start = useCallback(async () => {
    setFailed(null);
    const client = createProposalsClient({ api: "/api/val" });
    try {
      const made = await client.create({
        requestId,
        displayName: upgradeDisplayName(path),
        kind: "upgrade",
        upgrade: { path, ...(skip.length > 0 ? { skip } : {}) },
      });
      const origin = made.address ?? (await waitForAddress(client, made.name));
      // Replaced, not pushed: Back from the upgrade is not this page again.
      window.location.replace(upgradeTabUrl(origin, made.name));
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }, [path, requestId, skip]);
  const started = useRef(stale);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  return (
    <div className="min-h-full w-full flex items-center justify-center bg-bg-primary text-fg-primary p-6">
      <div
        role="status"
        className="w-full max-w-md rounded-xl border border-border-float bg-bg-float shadow-sm p-6"
      >
        <div className="flex items-center gap-2">
          {failed === null ? (
            <Loader2 size={18} className="shrink-0 animate-spin" />
          ) : (
            <AlertTriangle
              size={18}
              className="shrink-0 text-fg-error-primary"
            />
          )}
          <h1 className="text-lg font-semibold">
            {failed === null
              ? upgradeDisplayName(path)
              : "The upgrade did not start"}
          </h1>
        </div>
        <p className="mt-2 text-sm text-fg-secondary">
          {failed === null
            ? "Opening the upgrade's proposal. The upgrade runs in this tab until it is published."
            : failed}
        </p>
        {failed !== null && (
          <div className="mt-4 flex flex-wrap gap-2">
            {failed !== STALE_MESSAGE && (
              <button
                type="button"
                onClick={() => void start()}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium",
                  "bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover",
                )}
              >
                <RotateCcw size={14} /> Try again
              </button>
            )}
            <button
              type="button"
              onClick={() => window.close()}
              className="inline-flex h-8 items-center rounded-md border border-border-primary px-3 text-sm font-medium hover:bg-bg-float-raised"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
