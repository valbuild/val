import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useEffect, useMemo, useState } from "react";
import { useClient } from "../components/ValProvider";
import { HistoryStore } from "../stores/HistoryStore";

/**
 * One shared cache for the whole Studio session.
 *
 * Module-level rather than per-component, because the point of caching a
 * reconstructed commit is that flipping BETWEEN commits is cheap - and a cache
 * that lived inside the component showing one commit would be empty every time
 * you arrived at it. A reconstructed commit cannot change, so there is nothing
 * a longer-lived cache can get wrong.
 */
const store = new HistoryStore();

type CommitState =
  | { status: "loading" }
  | { status: "success"; patchSet: HistoricalPatchSet }
  | { status: "error"; message: string };

/**
 * Fetch a commit's reconstruction, or take it from the cache.
 *
 * The error is a MESSAGE rather than a thrown failure: a commit that cannot be
 * read is a normal thing for this view to show - it happens for commits made
 * before history was recorded, and for ones made outside Val - and the honest
 * response is a sentence, not a broken pane.
 */
export function useHistoricalCommit(
  commitSha: string | null,
): CommitState | null {
  const client = useClient();
  const cached = useMemo(
    () => (commitSha ? store.get(commitSha) : undefined),
    [commitSha],
  );
  const [state, setState] = useState<CommitState | null>(
    cached ? { status: "success", patchSet: cached } : null,
  );

  useEffect(() => {
    if (!commitSha) {
      setState(null);
      return;
    }
    const hit = store.get(commitSha);
    if (hit) {
      setState({ status: "success", patchSet: hit });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    client("/history/commit", "GET", { query: { commit_sha: commitSha } })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 200) {
          store.set(commitSha, res.json);
          setState({ status: "success", patchSet: res.json });
        } else {
          setState({
            status: "error",
            message:
              "message" in res.json
                ? res.json.message
                : "This commit could not be read.",
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    // Cancellation rather than ignoring a late response: switching commits
    // quickly must not let the first request's answer land on the second's
    // screen.
    return () => {
      cancelled = true;
    };
  }, [client, commitSha]);

  return state;
}
