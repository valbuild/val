import type { HistoricalCommit } from "@valbuild/shared/internal";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "../components/ValProvider";
import { fetchCommitPage } from "./commitPage";

export type CommitListState =
  | { status: "loading" }
  | {
      status: "success";
      commits: HistoricalCommit[];
      /** Null once the last page has been read. */
      nextCursor: string | null;
      /** True while a `loadMore` is in flight, so the list can stay on screen. */
      loadingMore: boolean;
      /**
       * Why the last `loadMore` did not arrive, if it did not.
       *
       * Separate from the `error` status because the pages already read are
       * still good: this reports a failure WITHOUT taking the list away.
       */
      loadMoreError: string | null;
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
  /*
   * The current state, readable from an event handler.
   *
   * `loadMore` needs to know the cursor and whether a page is already in
   * flight, and it must NOT learn them by starting the fetch inside a setState
   * updater: an updater has to be pure, and StrictMode calls it twice to prove
   * it - which fired two requests for the same cursor on every click. This
   * codebase has been bitten by that enough times to have written it down (see
   * ValStoreProvider and PageWorkspace).
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (branch === null) return;
    const id = ++requestId.current;
    setState({ status: "loading" });
    void fetchCommitPage(client, branch, pageSize, undefined).then((page) => {
      if (requestId.current !== id) return;
      if (page.status === "success") {
        setState({
          status: "success",
          commits: page.commits,
          nextCursor: page.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        });
      } else {
        setState({ status: "error", message: page.message });
      }
    });
  }, [client, branch, pageSize]);

  const loadMore = useCallback(() => {
    if (branch === null) return;
    const current = stateRef.current;
    if (
      current.status !== "success" ||
      current.nextCursor === null ||
      current.loadingMore
    ) {
      return;
    }
    const id = ++requestId.current;
    const cursor = current.nextCursor;
    setState({ ...current, loadingMore: true, loadMoreError: null });
    void fetchCommitPage(client, branch, pageSize, cursor).then((page) => {
      if (requestId.current !== id) return;
      setState((previous) => {
        if (previous.status !== "success") return previous;
        if (page.status !== "success") {
          // The pages already read stay on screen - failing to fetch page
          // three is not a reason to take pages one and two away - but the
          // button has to say something, or it just stops working.
          return {
            ...previous,
            loadingMore: false,
            loadMoreError: page.message,
          };
        }
        return {
          status: "success",
          commits: [...previous.commits, ...page.commits],
          nextCursor: page.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        };
      });
    });
  }, [client, branch, pageSize]);

  return { state, loadMore };
}
