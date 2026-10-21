import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { useStudioDeployState } from "../ValProvider";
import {
  INTENT_MAX_AGE_MS,
  joinHandoff,
  type HandedProposalBuild,
  type TabHandoff,
} from "../../publish/handoff";
import {
  describeDeployPhase,
  deployPercent,
} from "../../publish/deployProgress";
import {
  browserStorage,
  readKeyed,
  writeKeyed,
} from "../../publish/browserStorage";
import { buildProposal } from "../../proposals/proposalCode";
import { createProposalsClient } from "../../proposals/proposalsClient";
import { cn } from "../designSystem/cn";

/**
 * The builder tab a page that cannot build opened to build a proposal's code
 * (`build-proposal` in `HandoffIntent`): the proposal's Build, or the
 * assistant's `build_proposal`, from Safari, an iPhone, or anything else that
 * is not cross-origin isolated. A proposal's code is built wherever it is
 * changed from, so every browser has to be able to.
 *
 * It runs `buildProposal` -- the same build the Studio runs in place where it
 * can -- at the proposal's address, which is where it was opened, and reports
 * each step and the outcome back to the page. Nothing goes live on the site.
 *
 * Opened again -- reloaded, or the URL reopened -- it shows how the build
 * ended rather than building again; and an intent over an hour old is not a
 * build anyone is asking for now, so it starts nothing.
 */

/** Seconds a finished tab stays up before closing itself. */
const CLOSE_AFTER_S = 5;
const ENDING_PREFIX = "val-proposal-build-ending:";
/** As long as the intent is kept: a tab opened again within that shows its ending. */
const ENDING_KEEP_MS = 7 * 24 * 60 * 60_000;

const STALE_MESSAGE =
  "This build was asked for over an hour ago and never ran, so nothing was built. Press Build in the proposal to build it now.";

type Run =
  | { kind: "building"; startedAt: number }
  | { kind: "ended"; outcome: HandedProposalBuild };

export function HandoffProposalBuildTab({
  id,
  name,
  at,
}: {
  id: string;
  /** The proposal, as the tap that opened this named it. */
  name: string;
  /** When that tap was. */
  at: number;
}) {
  const { state, deploy } = useStudioDeployState();
  const [remembered] = useState(() => rememberedBuild(id));
  const stale = remembered === null && Date.now() - at > INTENT_MAX_AGE_MS;
  const [run, setRun] = useState<Run | null>(() =>
    remembered !== null
      ? { kind: "ended", outcome: remembered }
      : stale
        ? {
            kind: "ended",
            outcome: { status: "failed", message: STALE_MESSAGE },
          }
        : null,
  );
  const [closingIn, setClosingIn] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tab = useRef<TabHandoff | null>(null);
  const started = useRef(remembered !== null || stale);
  /** Read by the join below, which runs once per tab rather than per render. */
  const runRef = useRef(run);
  runRef.current = run;

  const start = useCallback(() => {
    const startedAt = Date.now();
    setRun({ kind: "building", startedAt });
    const proposals = createProposalsClient({ api: "/api/val" });
    void buildProposal({
      name,
      client: proposals,
      // This tab is the one that can: it is opened cross-origin isolated.
      canBuildHere: () => globalThis.crossOriginIsolated === true,
      deploy: async (files, target) =>
        (
          await deploy(null, files, {
            binaryFiles: null,
            branch: null,
            until: "confirmed",
            ...(target ? { target } : {}),
          })
        ).result,
    })
      .catch(
        (error): HandedProposalBuild => ({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      .then((built) => {
        const outcome = handedOf(built);
        rememberBuild(id, outcome);
        setRun({ kind: "ended", outcome });
        tab.current?.report({ type: "proposal-built", outcome });
        if (outcome.status !== "failed") setClosingIn(CLOSE_AFTER_S);
      });
  }, [deploy, id, name]);

  useEffect(() => {
    const handoff = joinHandoff(id, () => {});
    tab.current = handoff;
    if (!started.current) {
      started.current = true;
      start();
    } else {
      // Said again, so a page still waiting on it stops waiting.
      const ended = runRef.current;
      if (ended?.kind === "ended") {
        handoff.report({ type: "proposal-built", outcome: ended.outcome });
      }
    }
    return () => handoff.close();
  }, [id, start]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // The step, relayed to the page that opened this, so it says the same.
  useEffect(() => {
    if (run?.kind !== "building" || state.status !== "running") return;
    tab.current?.report({
      type: "phase",
      label: describeDeployPhase(state.phase),
      elapsedMs: now - run.startedAt,
      percent: deployPercent(state.phase),
    });
  }, [state, now, run]);

  useEffect(() => {
    if (closingIn === null) return;
    if (closingIn <= 0) {
      window.close();
      return;
    }
    const timer = setTimeout(() => setClosingIn(closingIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [closingIn]);

  const outcome = run?.kind === "ended" ? run.outcome : null;
  const step =
    run?.kind === "building" && state.status === "running"
      ? describeDeployPhase(state.phase)
      : "Starting the build";
  return (
    <div className="min-h-full w-full flex items-center justify-center bg-bg-primary text-fg-primary p-6">
      <div
        role="status"
        className="w-full max-w-md rounded-xl border border-border-float bg-bg-float shadow-sm p-6"
      >
        <div className="flex items-center gap-2">
          {outcome === null ? (
            <Loader2 size={18} className="shrink-0 animate-spin" />
          ) : outcome.status === "failed" ? (
            <AlertTriangle
              size={18}
              className="shrink-0 text-fg-error-primary"
            />
          ) : (
            <Check size={18} className="shrink-0 text-fg-brand-primary" />
          )}
          <h1 className="text-lg font-semibold">
            {outcome === null
              ? "Building the proposal"
              : outcome.status === "failed"
                ? "Not built"
                : "Built"}
          </h1>
        </div>
        <p className="mt-2 text-sm text-fg-secondary">
          {outcome === null
            ? `${step}…`
            : outcome.status === "failed"
              ? outcome.message
              : outcome.status === "nothing-staged"
                ? "Nothing is staged in the proposal, so there was nothing to build."
                : "The proposal's preview shows its code. Nothing changed on the site."}
        </p>
        {outcome !== null &&
          outcome.status !== "failed" &&
          closingIn !== null && (
            <p className="mt-1 text-xs text-fg-secondary-alt">
              {closingIn > 0
                ? `This tab closes in ${closingIn} s.`
                : "You can close this tab."}
            </p>
          )}
        {outcome !== null && (
          <div className="mt-4 flex flex-wrap gap-2">
            {outcome.status === "failed" &&
              outcome.message !== STALE_MESSAGE && (
                <button
                  type="button"
                  onClick={start}
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

/** What the page is told: the outcome, without the proposal read back. */
function handedOf(
  built: Awaited<ReturnType<typeof buildProposal>> | HandedProposalBuild,
): HandedProposalBuild {
  switch (built.status) {
    case "built":
      return { status: "built", hash: built.hash };
    case "already-built":
      return { status: "already-built", hash: built.hash };
    case "nothing-staged":
      return { status: "nothing-staged" };
    case "failed":
      return { status: "failed", message: built.message };
  }
}

function rememberBuild(id: string, outcome: HandedProposalBuild) {
  const storage = browserStorage();
  if (storage === null) return;
  writeKeyed(storage, ENDING_PREFIX, id, outcome, {
    now: Date.now(),
    keepMs: ENDING_KEEP_MS,
  });
}

function rememberedBuild(id: string): HandedProposalBuild | null {
  const storage = browserStorage();
  if (storage === null) return null;
  const entry = readKeyed(storage, ENDING_PREFIX, id);
  if (entry === null) return null;
  const value = entry.value;
  if (typeof value !== "object" || value === null || !("status" in value))
    return null;
  // A failure is never kept as the ending: opened again, the tab tries again.
  if (value.status === "built" || value.status === "already-built") {
    return {
      status: value.status,
      hash:
        "hash" in value && typeof value.hash === "string" ? value.hash : null,
    };
  }
  if (value.status === "nothing-staged") return { status: "nothing-staged" };
  return null;
}
