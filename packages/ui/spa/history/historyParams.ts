import type { SourcePath } from "@valbuild/core";

/**
 * The history view's state, as it lives in the URL.
 *
 * All of it is in the query rather than in a store, and that is the point: every
 * stage of a restore is a link. "I am looking at this field, as it was at that
 * commit, about to put it back here" survives a reload, a copy-paste into Slack,
 * and the back button — which is what makes a destructive action reviewable by
 * someone other than the person doing it.
 *
 * It also decides the shape of the feature. The left pane is the Studio, on its
 * normal route, with its normal navigation; history is a LAYER on top of that
 * route, not a route of its own. So `commit` turning up in the query is the
 * whole difference between the Studio and the two-pane history Studio, and none
 * of the left pane's navigation had to learn about any of this.
 */
export type HistoryParams = {
  /** The commit the right pane shows. Null means there is no right pane. */
  commitSha: string | null;
  /**
   * Whether the panes show the same path.
   *
   * On by default, because the thing people come here to do is compare one
   * field with its older self — and doing that with two independently navigated
   * trees means navigating twice, in step, forever.
   */
  locked: boolean;
  /** The right pane's own path. Only meaningful while unlocked. */
  rightPath: SourcePath | null;
  restore: RestoreState;
};

/**
 * Restore, as a state machine rather than a pair of nullable fields.
 *
 * The order is not incidental: you pick what to restore (on the right, in the
 * past) before you pick where it goes (on the left, today). A pair of optional
 * paths would let "a target with no source" be represented, and then every
 * reader would have to decide what that means. This cannot represent it.
 */
export type RestoreState =
  | { mode: "off" }
  | { mode: "picking-source" }
  | { mode: "picking-target"; from: SourcePath }
  | { mode: "confirming"; from: SourcePath; to: SourcePath };

export const HISTORY_PARAM = "commit";
export const HISTORY_LOCK_PARAM = "lock";
export const HISTORY_RIGHT_PATH_PARAM = "hp";
export const RESTORE_PARAM = "restore";
export const RESTORE_FROM_PARAM = "restore-from";
export const RESTORE_TO_PARAM = "restore-to";

/** Every param this module owns, for the router's carry-across list. */
export const HISTORY_OWNED_PARAMS = [
  HISTORY_PARAM,
  HISTORY_LOCK_PARAM,
  HISTORY_RIGHT_PATH_PARAM,
  RESTORE_PARAM,
  RESTORE_FROM_PARAM,
  RESTORE_TO_PARAM,
];

export const NO_HISTORY: HistoryParams = {
  commitSha: null,
  locked: true,
  rightPath: null,
  restore: { mode: "off" },
};

function toSearchParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : search;
}

/**
 * Read the history state out of a URL.
 *
 * Deliberately total: a URL someone hand-edited, or one written by an older
 * build, still has to produce a state the UI can render. Anything that does not
 * make sense is dropped rather than reported, so the worst outcome of a mangled
 * link is landing one step earlier in the flow than intended.
 */
export function parseHistoryParams(
  search: string | URLSearchParams,
): HistoryParams {
  const params = toSearchParams(search);
  const commitSha = params.get(HISTORY_PARAM);
  if (!commitSha) {
    // Without a commit there is no right pane, so nothing else can mean
    // anything: there is nowhere to restore FROM.
    return NO_HISTORY;
  }
  const locked = params.get(HISTORY_LOCK_PARAM) !== "0";
  const rightPathParam = params.get(HISTORY_RIGHT_PATH_PARAM);
  return {
    commitSha,
    locked,
    rightPath:
      locked || !rightPathParam ? null : (rightPathParam as SourcePath),
    restore: parseRestoreState(params),
  };
}

function parseRestoreState(params: URLSearchParams): RestoreState {
  if (params.get(RESTORE_PARAM) !== "1") {
    return { mode: "off" };
  }
  const from = params.get(RESTORE_FROM_PARAM);
  if (!from) {
    // A target with no source is not a state this flow has. Drop it and let the
    // user pick a source, rather than showing a half-made restore.
    return { mode: "picking-source" };
  }
  const to = params.get(RESTORE_TO_PARAM);
  if (!to) {
    return { mode: "picking-target", from: from as SourcePath };
  }
  return {
    mode: "confirming",
    from: from as SourcePath,
    to: to as SourcePath,
  };
}

/**
 * Write the history state into a URL's params, in place.
 *
 * Writes AND clears, so that handing it a state is enough — a caller that
 * turned restore off does not also have to remember which three params that
 * leaves behind. `parseHistoryParams(historyParams(state)) === state` for every
 * state; the test holds that.
 */
export function applyHistoryParams(
  params: URLSearchParams,
  state: HistoryParams,
): URLSearchParams {
  for (const owned of HISTORY_OWNED_PARAMS) {
    params.delete(owned);
  }
  if (!state.commitSha) {
    return params;
  }
  params.set(HISTORY_PARAM, state.commitSha);
  if (!state.locked) {
    params.set(HISTORY_LOCK_PARAM, "0");
    if (state.rightPath) {
      params.set(HISTORY_RIGHT_PATH_PARAM, state.rightPath);
    }
  }
  if (state.restore.mode !== "off") {
    params.set(RESTORE_PARAM, "1");
  }
  if (state.restore.mode === "picking-target") {
    params.set(RESTORE_FROM_PARAM, state.restore.from);
  }
  if (state.restore.mode === "confirming") {
    params.set(RESTORE_FROM_PARAM, state.restore.from);
    params.set(RESTORE_TO_PARAM, state.restore.to);
  }
  return params;
}

/** The params for a state, standalone — for building a link from nothing. */
export function historyParams(state: HistoryParams): URLSearchParams {
  return applyHistoryParams(new URLSearchParams(), state);
}

// --- the transitions, so no caller has to hand-assemble a state ---

export function enterRestore(state: HistoryParams): HistoryParams {
  return { ...state, restore: { mode: "picking-source" } };
}

export function exitRestore(state: HistoryParams): HistoryParams {
  return { ...state, restore: { mode: "off" } };
}

/**
 * Pick the field to restore, on the right.
 *
 * Picking a source again from `confirming` drops the target rather than keeping
 * it: the target was chosen because it was compatible with the OLD source, and
 * silently carrying it over is how you end up with a restore nobody checked.
 */
export function pickRestoreSource(
  state: HistoryParams,
  from: SourcePath,
): HistoryParams {
  return { ...state, restore: { mode: "picking-target", from } };
}

/** Pick where it goes, on the left. Only possible once a source is picked. */
export function pickRestoreTarget(
  state: HistoryParams,
  to: SourcePath,
): HistoryParams {
  if (state.restore.mode === "off" || state.restore.mode === "picking-source") {
    return state;
  }
  return {
    ...state,
    restore: { mode: "confirming", from: state.restore.from, to },
  };
}

export function clearRestoreTarget(state: HistoryParams): HistoryParams {
  if (state.restore.mode !== "confirming") {
    return state;
  }
  return {
    ...state,
    restore: { mode: "picking-target", from: state.restore.from },
  };
}
