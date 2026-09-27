/**
 * Whether this deployment has a published history to show at all.
 *
 * ONE function because there are two doors to the same page — the top bar's
 * History button and the review page's "Restore from history" — and they have
 * to agree. They did not: the top bar grew the branch half of this test and
 * the review page kept `mode === "http"`, so a git-less http project hid
 * History in the shell and offered Restore beside it. Two affordances
 * disagreeing about whether a feature exists is worse than either answer.
 *
 * Both halves are needed:
 *
 * - **`http`**, because `ValOpsFS` answers `not-supported-in-fs-mode`: local
 *   dev has git, not a commit archive.
 * - **A resolved branch**, because history is listed PER BRANCH. `gitBranch`
 *   is optional in `val.config` and the server fills in the one it resolved
 *   (see `clientConfig`), so null here means a project with no git mirror at
 *   all — `HistoryView` has no request to make there and says so.
 *
 * A door that opens onto an apology should not be there, which is the rule the
 * comments at both call sites state and this makes true.
 */
export function historyEnabledFor(deployment: {
  mode: "http" | "fs" | "unknown";
  gitBranch: string | null;
}): boolean {
  return deployment.mode === "http" && deployment.gitBranch !== null;
}
