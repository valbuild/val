import { useEffect, useRef, useState } from "react";
import { useStudioDeployState } from "../ValProvider";
import { joinHandoff, type TabHandoff } from "../../publish/handoff";
import {
  describeDeployFailure,
  describeDeployPhase,
  describeDeployStep,
} from "../../publish/deployProgress";
import type { DeployPhase } from "../../publish/runStudioDeploy";
import type { StudioDeployState } from "../../publish/useStudioDeploy";
import {
  StudioPublishPage,
  type PublishPageResult,
  type PublishStep,
} from "./PublishHandoff";

/**
 * The Studio tab a page that cannot build opened to publish its commit.
 *
 * It waits for the commit (the save runs on the site after this tab opened),
 * builds and publishes it with the same deploy a Finish publishing uses -- from
 * `/built-source`, so it needs nothing but the commit and the images that save
 * uploaded -- and reports each step back to the page that is waiting.
 */

const ORDER: DeployPhase["kind"][] = [
  "getting-ready",
  "reading",
  "building",
  "declaring",
  "uploading",
  "confirming",
  "verifying",
  "promoting",
  "propagating",
];

/** Seconds a live tab stays up before closing itself. */
const CLOSE_AFTER_S = 5;

type Waiting =
  | { kind: "waiting"; since: number }
  | { kind: "started"; savedAfterMs: number; commit: string | null }
  | { kind: "cancelled"; message: string };

export function HandoffPublishTab({ id }: { id: string }) {
  const { state, deploy } = useStudioDeployState();
  const [waiting, setWaiting] = useState<Waiting>(() => ({
    kind: "waiting",
    since: Date.now(),
  }));
  const [closingIn, setClosingIn] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tab = useRef<TabHandoff | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const handoff = joinHandoff(id, (message) => {
      if (message.type === "cancel") {
        if (!started.current) {
          setWaiting({ kind: "cancelled", message: message.message });
        }
        return;
      }
      // Once: the site re-sends the commit whenever a tab says it is ready.
      if (started.current) return;
      started.current = true;
      setWaiting((prev) => ({
        kind: "started",
        savedAfterMs: prev.kind === "waiting" ? Date.now() - prev.since : 0,
        commit: message.commit,
      }));
      void deploy(message.commit, message.committedFiles ?? null, {
        binaryFiles: message.binaryFiles,
        branch: message.branch,
      });
    });
    tab.current = handoff;
    return () => handoff.close();
  }, [id, deploy]);

  // Ticks the elapsed time here, and relays it to the waiting page.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (state.status !== "running") return;
    tab.current?.report({
      type: "phase",
      label: describeDeployPhase(state.phase),
      elapsedMs: now - state.startedAt,
    });
  }, [state, now]);

  const reported = useRef(false);
  useEffect(() => {
    if (state.status !== "done" || !started.current || reported.current) return;
    reported.current = true;
    tab.current?.report({
      type: "done",
      result: state.result,
      ms: state.ms,
      ...(state.result.status === "failed"
        ? { summary: describeDeployFailure(state.failedAt ?? undefined) }
        : {}),
    });
    if (state.result.status !== "failed") setClosingIn(CLOSE_AFTER_S);
  }, [state]);

  useEffect(() => {
    if (closingIn === null) return;
    if (closingIn <= 0) {
      window.close();
      return;
    }
    const timer = setTimeout(() => setClosingIn(closingIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [closingIn]);

  const steps = stepsOf(waiting, state);
  const result: PublishPageResult | undefined =
    waiting.kind === "cancelled"
      ? { kind: "failed", message: waiting.message }
      : state.status === "done" && started.current
        ? state.result.status === "failed"
          ? {
              kind: "failed",
              message: describeDeployFailure(state.failedAt ?? undefined),
              details: state.result.message,
            }
          : {
              kind: "live",
              ms: state.ms,
              ...(closingIn !== null && closingIn > 0
                ? { closingInS: closingIn }
                : {}),
            }
        : undefined;
  const elapsedMs =
    waiting.kind === "waiting"
      ? now - waiting.since
      : state.status === "running"
        ? now - state.startedAt
        : state.status === "done"
          ? state.ms
          : 0;

  return (
    <div style={{ height: "100svh" }}>
      <StudioPublishPage
        commit={waiting.kind === "started" ? (waiting.commit ?? "") : ""}
        steps={steps}
        elapsedMs={elapsedMs}
        result={result}
        onViewSite={() => {
          window.location.href = "/";
        }}
        onOpenStudio={() => {
          window.location.href = "/val";
        }}
        onClose={() => window.close()}
      />
    </div>
  );
}

function stepsOf(waiting: Waiting, state: StudioDeployState): PublishStep[] {
  const saved: PublishStep =
    waiting.kind === "waiting"
      ? { label: "Saving your change", status: "current" }
      : waiting.kind === "cancelled"
        ? { label: "Saving your change", status: "failed" }
        : {
            label: "Saving your change",
            status: "done",
            ms: waiting.savedAfterMs,
          };
  const finished = new Map<DeployPhase["kind"], number>();
  const recorded =
    state.status === "running"
      ? (state.steps ?? [])
      : state.status === "done"
        ? state.steps
        : [];
  for (const step of recorded) finished.set(step.kind, step.ms);
  const current = state.status === "running" ? state.phase : null;
  const failed = state.status === "done" && state.result.status === "failed";
  const rest = ORDER.map((kind): PublishStep => {
    if (current !== null && current.kind === kind) {
      // The live wording while it runs: "Uploading 3 of 7".
      return {
        label:
          kind === "propagating"
            ? describeDeployStep(kind)
            : describeDeployPhase(current),
        status: "current",
      };
    }
    const label = describeDeployStep(kind);
    const ms = finished.get(kind);
    if (ms !== undefined) return { label, status: "done", ms };
    return { label, status: "todo" };
  });
  if (failed) {
    // The last step that ran is where it stopped.
    const last = [...rest].reverse().find((step) => step.status === "done");
    if (last) last.status = "failed";
  }
  return [saved, ...rest];
}
