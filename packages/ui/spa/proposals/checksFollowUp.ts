import { useSyncExternalStore } from "react";
import {
  currentToolNotices,
  toldNow,
  untoldToolNotices,
  type ToolNotice,
} from "./toolNotices";
import { knownStagedInputs } from "./backgroundChecks";
import type { AIMessageContentBlock } from "../hooks/useAIWebSocket";
import { CHECKS_MESSAGE_MARKER } from "./checksMessage";

export {
  CHECKS_MESSAGE_MARKER,
  isChecksMessage,
  stripChecksMessage,
} from "./checksMessage";

/**
 * What happens when a background check finds a problem while the assistant
 * is idle: it is handed the findings in a turn of their own, started by the
 * Studio rather than by the person -- the follow-up.
 *
 * That is a loop with a model on both sides of it (the assistant fixes, the
 * checks check, the assistant fixes...), so it has a mechanical stop, and
 * nothing either model says can move it:
 *
 * - **A budget, filled only by the person.** Each message from the person
 *   allows {@link AUTO_FOLLOW_UPS_PER_MESSAGE} follow-ups; each follow-up
 *   spends one. A follow-up's own turn does not refill it.
 * - **No progress, no turn.** Findings with the same fingerprint as the last
 *   follow-up's mean the fix did not help: no turn is started, even with
 *   budget left.
 * - **In memory only.** A reload starts with none, so nothing starts on its
 *   own until the person writes again. Only the tab the person wrote from has
 *   any, so two tabs on one chat cannot both start one.
 *
 * When it stops, the findings stay where the person can see them, with a
 * "Fix it" that sends a message as them -- which refills the budget.
 */
export const AUTO_FOLLOW_UPS_PER_MESSAGE = 2;

export type FollowUpBudget = {
  left: number;
  /** The findings the last follow-up was about. */
  lastFingerprint: string | null;
};

/** What a tab starts with, and what a reload gives: nothing until the person writes. */
export const NO_FOLLOW_UPS: FollowUpBudget = { left: 0, lastFingerprint: null };

/** What a message from the person gives. */
export const FRESH_FOLLOW_UPS: FollowUpBudget = {
  left: AUTO_FOLLOW_UPS_PER_MESSAGE,
  lastFingerprint: null,
};

/** One check's finding, as the follow-up weighs it. */
export type CheckFinding = {
  /** The notice's key: `typecheck_errors`, `page_check`, ... */
  key: string;
  value: unknown;
  /** Whether it asks for a fix: errors and a failed page check do; a pass does not. */
  failing: boolean;
};

export type FollowUpDecision =
  | { action: "start"; budget: FollowUpBudget; attempt: number }
  | {
      action: "stop";
      reason: "nothing-failing" | "budget" | "no-progress";
      budget: FollowUpBudget;
    };

/** Whether to start a follow-up for these findings: see above. */
export function followUpDecision(
  budget: FollowUpBudget,
  findings: CheckFinding[],
): FollowUpDecision {
  const failing = findings.filter((finding) => finding.failing);
  if (failing.length === 0) {
    return { action: "stop", reason: "nothing-failing", budget };
  }
  const fingerprint = findingsFingerprint(failing);
  if (fingerprint === budget.lastFingerprint) {
    return { action: "stop", reason: "no-progress", budget };
  }
  if (budget.left <= 0) return { action: "stop", reason: "budget", budget };
  return {
    action: "start",
    budget: { left: budget.left - 1, lastFingerprint: fingerprint },
    attempt: AUTO_FOLLOW_UPS_PER_MESSAGE - budget.left + 1,
  };
}

/**
 * The same findings, whatever order they came in: what makes "the fix did
 * not help" mechanical. The `next` hints are left out; they are ours.
 */
export function findingsFingerprint(findings: CheckFinding[]): string {
  return JSON.stringify(
    [...findings]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((finding) => [finding.key, withoutHints(finding.value)]),
  );
}

function withoutHints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutHints);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "next")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, withoutHints(inner)]),
  );
}

/** The follow-up's message: what the checks found, for the assistant. */
export function checksMessage(findings: CheckFinding[]): string {
  const body = Object.fromEntries(
    findings.map((finding) => [finding.key, finding.value]),
  );
  return `${CHECKS_MESSAGE_MARKER} The checks that run beside you found problems in the change you just made. Fix the ones that are still there, then end your turn. The person did not write this message.\n\n${JSON.stringify(body, null, 2)}`;
}

/** What the person is shown of the follow-ups. */
export type ChecksFollowUpState =
  | { status: "idle" }
  /** A follow-up turn runs: the assistant is fixing what the checks found. */
  | { status: "fixing"; attempt: number; of: number }
  /**
   * The findings are left for the person: the follow-ups ran out, or the
   * last one did not help. "Fix it" sends a message as them.
   */
  | {
      status: "stopped";
      reason: "budget" | "no-progress";
      /** How many follow-ups ran before it stopped: none after a reload. */
      attempts: number;
      findings: CheckFinding[];
    };

const IDLE: ChecksFollowUpState = { status: "idle" };
let current: ChecksFollowUpState = IDLE;
const listeners = new Set<() => void>();
export function setChecksFollowUp(next: ChecksFollowUpState): void {
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => current;

export function checksFollowUpState(): ChecksFollowUpState {
  return current;
}

/** The follow-ups, for what shows them. */
export function useChecksFollowUp(): ChecksFollowUpState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** For tests: back to none. */
export function resetChecksFollowUp(): void {
  current = IDLE;
}

/** What the follow-ups reach. */
export type ChecksFollowUpDeps = {
  /** The proposal, while the assistant changes code in it; else `null`. */
  proposalName: () => string | null;
  /** Whether the assistant is idle: no turn of the chat's runs. */
  idle: () => boolean;
  /** What is staged now, as content says. */
  stagedInputs: (name: string) => Promise<string | null>;
  /** Send a follow-up's message: `AIChatHandle.sendChecksMessage`. */
  send: (text: string) => boolean;
};

export type ChecksFollowUp = {
  /** The person wrote: the follow-ups start over. */
  personWrote: () => void;
  /**
   * A check finished, or a turn ended: start a follow-up when the assistant
   * is idle and something it has not heard asks for a fix.
   */
  consider: () => Promise<void>;
  /**
   * What the checks found that the assistant has not heard, to go with the
   * person's message: what "goes with the queued message" means. Marked
   * told by `sent`, once the message is.
   */
  rideAlong: (name: string) => { text: string; sent: () => void } | null;
};

const toFinding = (notice: ToolNotice): CheckFinding => ({
  key: notice.key,
  value: notice.value,
  failing: notice.failing,
});

export function createChecksFollowUp(deps: ChecksFollowUpDeps): ChecksFollowUp {
  let budget = NO_FOLLOW_UPS;
  let attempts = 0;
  let running: Promise<void> | null = null;
  let again = false;

  const considerOnce = async () => {
    const name = deps.proposalName();
    if (name === null || !deps.idle()) return;
    const notices = await currentToolNotices(name, () =>
      deps.stagedInputs(name),
    );
    // Something may have started while content was asked.
    if (!deps.idle() || deps.proposalName() !== name) return;
    const findings = notices.map(toFinding);
    const decision = followUpDecision(budget, findings);
    if (decision.action === "stop") {
      if (decision.reason === "nothing-failing") {
        if (checksFollowUpState().status !== "idle") {
          setChecksFollowUp({ status: "idle" });
        }
        return;
      }
      setChecksFollowUp({
        status: "stopped",
        reason: decision.reason,
        attempts,
        findings: findings.filter((finding) => finding.failing),
      });
      return;
    }
    // Not idle after all, or a message waits: they go with that one.
    if (!deps.send(checksMessage(findings))) return;
    budget = decision.budget;
    attempts = decision.attempt;
    toldNow(notices);
    setChecksFollowUp({
      status: "fixing",
      attempt: decision.attempt,
      of: AUTO_FOLLOW_UPS_PER_MESSAGE,
    });
  };

  const consider = (): Promise<void> => {
    if (running !== null) {
      again = true;
      return running;
    }
    running = considerOnce()
      .catch(() => {
        // A check that cannot be read is one the assistant hears of on its
        // next tool answer instead.
      })
      .then(async () => {
        running = null;
        if (again) {
          again = false;
          await consider();
        }
      });
    return running;
  };

  return {
    personWrote: () => {
      budget = FRESH_FOLLOW_UPS;
      attempts = 0;
      setChecksFollowUp({ status: "idle" });
    },
    consider,
    rideAlong: (name) => {
      const inputs = knownStagedInputs(name);
      const notices = untoldToolNotices(name).filter(
        (notice) => notice.inputs === null || notice.inputs === inputs,
      );
      if (notices.length === 0) return null;
      const body = Object.fromEntries(
        notices.map((notice) => [notice.key, notice.value]),
      );
      return {
        text: `<background_checks>\n${JSON.stringify(body, null, 2)}\n</background_checks>`,
        sent: () => {
          toldNow(notices);
        },
      };
    },
  };
}

/** A prompt's content with the findings that ride along after its text. */
export function withRideAlong(
  blocks: AIMessageContentBlock[],
  text: string | null,
): AIMessageContentBlock[] {
  if (text === null) return blocks;
  let added = false;
  const out = blocks.map((block): AIMessageContentBlock => {
    if (added || block.type !== "text") return block;
    added = true;
    return { ...block, text: `${block.text}\n\n${text}` };
  });
  return added ? out : [{ type: "text", text }, ...out];
}
