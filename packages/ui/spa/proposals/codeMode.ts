import { useSyncExternalStore } from "react";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import type { ProposalJson, ProposalsClient } from "./proposalsClient";

/**
 * Code mode (`docs/plans/one-content-model.md`, "Code mode"): a state of the
 * PROPOSAL, kept by the content service and the same for everyone in it,
 * in which the assistant may change the proposal's code. What each person
 * LOOKS at while it is on -- its workspace, or the content editor -- is
 * their own, and kept here, in this tab.
 *
 * Content and code are never in two places when code changes: turning it on
 * saves every pending change, and Val's server saves the changes made since
 * before each code write (`/proposals-api/<name>/files`). Turning it off
 * discards nothing: it stops those saves, and the code tools refuse.
 */

/**
 * Whether code may be changed in a proposal now, as the code tools are told:
 * when not, who turned code mode off and when, in words.
 */
export type CodeModeNow =
  | { on: true }
  | {
      on: false;
      /** Who turned it off: a name, or `null` when nobody ever turned it on. */
      by: string | null;
      /** "5 minutes ago", or `null` when not known. */
      ago: string | null;
    };

/**
 * A proposal's code mode, as content answers it: `nameOf` turns the profile
 * id of who changed it into a name. Older content, which has no code mode,
 * reads as off and never turned on.
 */
export function codeModeNow(
  proposal: Pick<ProposalJson, "codeMode">,
  nameOf: (profileId: string) => string | null,
  now: number,
): CodeModeNow {
  const mode = proposal.codeMode;
  if (mode?.on === true) return { on: true };
  return {
    on: false,
    by: mode?.changedBy != null ? (nameOf(mode.changedBy) ?? "someone") : null,
    ago:
      mode?.changedAt != null ? formatRelativeTime(mode.changedAt, now) : null,
  };
}

/**
 * The proposal's code mode now, read from content: what the code tools ask
 * before they write (`CodeToolDeps.codeMode`).
 */
export async function readCodeMode(
  client: Pick<ProposalsClient, "get">,
  name: string,
  nameOf: (profileId: string) => string | null,
): Promise<CodeModeNow> {
  return codeModeNow(await client.get(name), nameOf, Date.now());
}

/**
 * What a code tool answers when code mode is off: who turned it off, and
 * what to do instead. The assistant reads it; it says so to the person.
 */
export function codeModeOffMessage(
  off: Extract<CodeModeNow, { on: false }>,
): string {
  const who =
    off.by === null
      ? "Code mode is not on in this proposal"
      : `Code mode is off in this proposal: ${off.by} turned it off${off.ago !== null ? ` ${off.ago}` : ""}`;
  return `${who}, so its code cannot be changed now. Nothing was written. If the person's request needs a code change, call request_code_mode so they can turn it on; content can still be changed with create_patch.`;
}

/**
 * The query parameter that opens a proposal in code mode: the `</>` menu on
 * the site goes to the chosen proposal's address with it, and the Studio
 * there turns code mode on (if it is off) and shows its workspace. Taken out
 * of the address once acted on, so a reload does not ask again.
 */
export const CODE_MODE_PARAM = "val_code_mode";

/** `url` with the parameter that asks for code mode. */
export function withCodeModeParam(url: string): string {
  const next = new URL(url);
  next.searchParams.set(CODE_MODE_PARAM, "on");
  return next.href;
}

/** Whether `url` asks for code mode. */
export function asksForCodeMode(url: string): boolean {
  return new URL(url).searchParams.get(CODE_MODE_PARAM) === "on";
}

/** `url` without the parameter, once it has been acted on. */
export function withoutCodeModeParam(url: string): string {
  const next = new URL(url);
  next.searchParams.delete(CODE_MODE_PARAM);
  return next.href;
}

/**
 * Code mode as this tab knows it, shared by the top bar (`useProposalsBar`,
 * which reads it from content and turns it on and off) and the assistant
 * (`useAI`, whose `request_code_mode` card turns it on with the same call).
 */
export type CodeModeState = {
  /**
   * The proposal this Studio is in, with its code mode; `null` on the site,
   * or before it is known.
   */
  proposal: { name: string; displayName: string; on: boolean } | null;
  /** Turning it on or off now. */
  busy: boolean;
  /**
   * On the site: the `</>` menu asked for from the chat ("Choose a
   * proposal…"). A count, so asking twice opens it twice.
   */
  menuRequests: number;
};

let state: CodeModeState = {
  proposal: null,
  busy: false,
  menuRequests: 0,
};
const listeners = new Set<() => void>();

function set(next: Partial<CodeModeState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): CodeModeState {
  return state;
}

/** The current state, for code outside React (the assistant's handlers). */
export function codeModeState(): CodeModeState {
  return state;
}

export function useCodeModeState(): CodeModeState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The proposal's code mode, as the top bar last read it. */
export function reportCodeMode(proposal: CodeModeState["proposal"]): void {
  const before = state.proposal;
  if (
    before?.name === proposal?.name &&
    before?.on === proposal?.on &&
    before?.displayName === proposal?.displayName
  ) {
    return;
  }
  set({ proposal });
}

export function setCodeModeBusy(busy: boolean): void {
  if (state.busy !== busy) set({ busy });
}

/** Open the `</>` menu on the site: the assistant's "Choose a proposal…". */
export function requestCodeModeMenu(): void {
  set({ menuRequests: state.menuRequests + 1 });
}

/**
 * Turn code mode on: what the `</>` does, registered by the top bar, which
 * holds the client and reads the proposal again after. Answers why it could
 * not, or `null` when it is on. With nothing registered (no proposals here),
 * it says so.
 */
let turnOn: (() => Promise<string | null>) | null = null;

export function registerCodeModeTurnOn(
  impl: (() => Promise<string | null>) | null,
): void {
  turnOn = impl;
}

export function turnOnCodeMode(): Promise<string | null> {
  if (turnOn === null) {
    return Promise.resolve(
      "Code mode can only be turned on in a proposal, from its own Studio.",
    );
  }
  return turnOn();
}

/** For tests and stories: back to nothing known. */
export function resetCodeMode(): void {
  turnOn = null;
  set({ proposal: null, busy: false, menuRequests: 0 });
}
