import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import {
  buildQuickPreview,
  createStudioPublishClient,
} from "@valbuild/shared/publish";
import {
  INTENT_MAX_AGE_MS,
  joinHandoff,
  type HandedQuickPreview,
  type TabHandoff,
} from "../../publish/handoff";
import { loadBuilder, routeTreeGenerator } from "../../publish/loadBuilder";
import { createProposalsClient } from "../../proposals/proposalsClient";
import { Spinner } from "../designSystem/spinner";

/**
 * The builder tab a design tab that cannot build opened for a quick preview
 * (`quick-preview` in `HandoffIntent`): Safari, an iPhone. It bundles the
 * proposal's client code (`buildQuickPreview`), as the design tab does where
 * it can, and hands the files back; the design tab shows them. Nothing is
 * uploaded.
 *
 * Opened again it starts nothing: a quick preview is for the moment it was
 * asked for, and the page asks again with a tap.
 */

/** How often the tab says where it is, so the page knows it is still here. */
const REPORT_EVERY_MS = 1000;
/** Seconds a finished tab stays up before closing itself. */
const CLOSE_AFTER_MS = 1500;

type Run =
  | { kind: "building"; step: string; startedAt: number }
  | { kind: "ended"; outcome: HandedQuickPreview };

export function HandoffQuickPreviewTab({
  id,
  name,
  at,
}: {
  id: string;
  name: string;
  at: number;
}) {
  const [run, setRun] = useState<Run>(() =>
    Date.now() - at > INTENT_MAX_AGE_MS
      ? {
          kind: "ended",
          outcome: {
            status: "failed",
            message:
              "This quick preview was asked for a while ago. Press Quick preview in the design tab again.",
          },
        }
      : {
          kind: "building",
          step: "Reading the proposal",
          startedAt: Date.now(),
        },
  );
  const tab = useRef<TabHandoff | null>(null);
  const started = useRef(false);
  /** How it began: read by the join below, which runs once per tab. */
  const initial = useRef(run);

  useEffect(() => {
    const handoff = joinHandoff(id, () => {});
    tab.current = handoff;
    const first = initial.current;
    if (!started.current && first.kind === "building") {
      started.current = true;
      const startedAt = Date.now();
      const generateRouteTree = routeTreeGenerator();
      const publish = createStudioPublishClient({ api: "/api/val" });
      void buildQuickPreview({
        name,
        proposals: createProposalsClient({ api: "/api/val" }),
        siteSource: () => publish.projectSource(),
        siteTarget: () => publish.buildTarget(),
        loadBuilder,
        ...(generateRouteTree !== null ? { generateRouteTree } : {}),
        onStep: (step) => setRun({ kind: "building", step, startedAt }),
      })
        .catch(
          (error): HandedQuickPreview => ({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        .then((built) => {
          const outcome: HandedQuickPreview =
            built.status === "built"
              ? { status: "built", files: built.files }
              : { status: "failed", message: built.message };
          setRun({ kind: "ended", outcome });
          handoff.report({ type: "quick-preview-built", outcome });
        });
    } else if (first.kind === "ended") {
      handoff.report({ type: "quick-preview-built", outcome: first.outcome });
    }
    return () => handoff.close();
  }, [id, name]);

  // Where it is, every second, so the page that opened it says the same and
  // knows it is still here.
  useEffect(() => {
    if (run.kind !== "building") return;
    const report = () =>
      tab.current?.report({
        type: "phase",
        label: run.step,
        elapsedMs: Date.now() - run.startedAt,
      });
    report();
    const timer = setInterval(report, REPORT_EVERY_MS);
    return () => clearInterval(timer);
  }, [run]);

  const built = run.kind === "ended" && run.outcome.status === "built";
  useEffect(() => {
    if (!built) return;
    const timer = setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [built]);

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-bg-primary p-6 text-fg-primary">
      <div
        role="status"
        className="w-full max-w-md rounded-xl border border-border-float bg-bg-float p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          {run.kind === "building" ? (
            <Spinner size={18} />
          ) : run.outcome.status === "failed" ? (
            <AlertTriangle
              size={18}
              className="shrink-0 text-fg-error-primary"
            />
          ) : (
            <Check size={18} className="shrink-0 text-fg-brand-primary" />
          )}
          <h1 className="text-lg font-semibold">
            {run.kind === "building"
              ? "Preparing the quick preview"
              : run.outcome.status === "failed"
                ? "No quick preview"
                : "Ready"}
          </h1>
        </div>
        <p className="mt-2 text-sm text-fg-secondary">
          {run.kind === "building"
            ? `${run.step}…`
            : run.outcome.status === "failed"
              ? run.outcome.message
              : "The design tab shows it now. This tab closes by itself."}
        </p>
        {run.kind === "ended" && run.outcome.status === "failed" && (
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-4 inline-flex h-8 items-center rounded-md border border-border-primary px-3 text-sm font-medium hover:bg-bg-float-raised"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
