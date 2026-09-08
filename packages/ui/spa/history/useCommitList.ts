import type { HistoricalCommit } from "@valbuild/shared/internal";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "../components/ValProvider";

export type CommitListState =
  | { status: "loading" }
  | {
      status: "success";
      commits: HistoricalCommit[];
      /** Null once the last page has been read. */
      nextCursor: string | null;
      /** True while a `loadMore` is in flight, so the list can stay on screen. */
      loadingMore: boolean;
    }
  | { status: "error"; message: string };

/**
 * The commits on a branch, newest first, a page at a time.
 *
 * Deliberately NOT cached the way `useHistoricalCommit` caches a reconstructed
 * commit. A reconstruction is immutable for its sha and can be kept forever; a
 * LIST has a head that moves every time anyone publishes, so a cached first
 * page is a list that quietly stops including the change you just made. The
 * endpoint is `no-store` for the same reason.
 *
 * Paging appends rather than replaces, because the cursor is a position in one
 * ordering: dropping the pages already read would make "load more" mean "show
 * me a different ten", which is not what the button says.
 */
export function useCommitList(
  branch: string | null,
  pageSize = 20,
): { state: CommitListState; loadMore: () => void } {
  const client = useClient();
  const [state, setState] = useState<CommitListState>({ status: "loading" });
  /*
   * Which request's answer is still wanted.
   *
   * A ref rather than a cancelled flag per effect, because `loadMore` is called
   * from an event handler and has no effect cleanup to hang one on. Every
   * response checks it, so a page that arrives after the branch changed is
   * dropped instead of appended to a list it does not belong to.
   */
  const requestId = useRef(0);

  useEffect(() => {
    if (branch === null) return;
    const id = ++requestId.current;
    setState({ status: "loading" });
    client("/history/commits", "GET", {
      query: { branch, limit: pageSize, cursor: undefined },
    })
      .then((res) => {
        if (requestId.current !== id) return;
        if (res.status === 200) {
          setState({
            status: "success",
            commits: res.json.commits,
            nextCursor: res.json.nextCursor,
            loadingMore: false,
          });
        } else {
          setState({
            status: "error",
            message:
              "message" in res.json
                ? res.json.message
                : "The commit history could not be read.",
          });
        }
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [client, branch, pageSize]);

  const loadMore = useCallback(() => {
    if (branch === null) return;
    setState((current) => {
      if (
        current.status !== "success" ||
        current.nextCursor === null ||
        current.loadingMore
      ) {
        return current;
      }
      const id = ++requestId.current;
      const cursor = current.nextCursor;
      client("/history/commits", "GET", {
        query: { branch, limit: pageSize, cursor },
      })
        .then((res) => {
          if (requestId.current !== id) return;
          if (res.status === 200) {
            setState((previous) =>
              previous.status === "success"
                ? {
                    status: "success",
                    commits: [...previous.commits, ...res.json.commits],
                    nextCursor: res.json.nextCursor,
                    loadingMore: false,
                  }
                : previous,
            );
          } else {
            // The pages already read stay on screen: failing to fetch page
            // three is not a reason to take pages one and two away.
            setState((previous) =>
              previous.status === "success"
                ? { ...previous, loadingMore: false }
                : previous,
            );
          }
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setState((previous) =>
            previous.status === "success"
              ? { ...previous, loadingMore: false }
              : previous,
          );
        });
      return { ...current, loadingMore: true };
    });
  }, [client, branch, pageSize]);

  return { state, loadMore };
}
