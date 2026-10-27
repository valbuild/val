/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type { HistoricalCommit } from "@valbuild/shared/internal";
import { CommitList, describeCommit } from "./CommitList";
import type { CommitListState } from "./useCommitList";

const commit = (over: Partial<HistoricalCommit> = {}): HistoricalCommit => ({
  commitSha: "aaa111",
  parentCommitSha: "000000",
  clientCommitSha: "000000",
  branch: "main",
  createdBranch: null,
  creator: "Ada",
  message: "Fix the footer",
  createdAt: "2026-09-08T12:42:21.843Z",
  seqNum: "1",
  patchCount: 3,
  hasArchive: true,
  ...over,
});

const listOf = (...commits: HistoricalCommit[]): CommitListState => ({
  status: "success",
  commits,
  nextCursor: null,
  loadingMore: false,
  loadMoreError: null,
});

function renderList(
  state: CommitListState,
  over: Partial<Parameters<typeof CommitList>[0]> = {},
) {
  const onSelect = jest.fn();
  const onStopComparing = jest.fn();
  const onLoadMore = jest.fn();
  render(
    <CommitList
      state={state}
      selectedCommitSha={null}
      onSelect={onSelect}
      onStopComparing={onStopComparing}
      onLoadMore={onLoadMore}
      {...over}
    />,
  );
  return { onSelect, onStopComparing, onLoadMore };
}

describe("the commit list", () => {
  test("opens a commit when its row is clicked", () => {
    const { onSelect } = renderList(listOf(commit()));
    fireEvent.click(screen.getByRole("button", { name: /Fix the footer/ }));
    expect(onSelect).toHaveBeenCalledWith("aaa111");
  });

  /*
   * Commits made before Val recorded history, and ones pushed straight to the
   * repo, have no archive. They are LISTED - leaving them out would make the
   * history look like it holds fewer changes than it does - but there is
   * nothing behind them to open.
   */
  test("lists a commit with no archive, but will not open it", () => {
    const { onSelect } = renderList(
      listOf(commit({ hasArchive: false, message: "Pushed by hand" })),
    );
    const row = screen.getByRole("button", { name: /Pushed by hand/ });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  /*
   * `aria-disabled` rather than `disabled`, so the title saying WHY is
   * reachable. A `disabled` button fires no pointer events and is out of the
   * tab order, which makes its own explanation the one thing nobody can get to.
   */
  test("keeps the reason it cannot be opened reachable", () => {
    renderList(
      listOf(commit({ hasArchive: false, message: "Pushed by hand" })),
    );
    const row = screen.getByRole("button", { name: /Pushed by hand/ });
    expect((row as HTMLButtonElement).disabled).toBe(false);
    expect(row.getAttribute("title")).toMatch(/nothing to compare against/);
  });

  test("offers a way out once a commit is open", () => {
    const { onStopComparing } = renderList(listOf(commit()), {
      selectedCommitSha: "aaa111",
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop comparing" }));
    expect(onStopComparing).toHaveBeenCalled();
  });

  test("has no way out when nothing is open", () => {
    renderList(listOf(commit()));
    expect(screen.queryByRole("button", { name: "Stop comparing" })).toBeNull();
  });

  test("offers more only while there is another page", () => {
    renderList(listOf(commit()));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  test("loads the next page on request", () => {
    const { onLoadMore } = renderList({
      status: "success",
      commits: [commit()],
      nextCursor: "cursor-1",
      loadingMore: false,
      loadMoreError: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  test("says so when nothing has been published", () => {
    renderList(listOf());
    expect(screen.getByText(/Nothing has been published/)).not.toBeNull();
  });

  test("shows the reason it could not read the history", () => {
    renderList({ status: "error", message: "The archive is unreadable." });
    expect(screen.getByText("The archive is unreadable.")).not.toBeNull();
  });
});

describe("what a row says about a commit", () => {
  test("names the time, the author and the size of the change", () => {
    expect(describeCommit(commit())).toMatch(/Ada/);
    expect(describeCommit(commit())).toMatch(/3 changes/);
  });

  test("says '1 change', not '1 changes'", () => {
    expect(describeCommit(commit({ patchCount: 1 }))).toMatch(/1 change$/);
  });

  // `creator` is null for a commit Val did not make. A template with holes in
  // it would render "· by " with nothing after it, which reads like a bug.
  test("leaves the author out when there is not one", () => {
    const described = describeCommit(commit({ creator: null }));
    expect(described).not.toMatch(/·\s*·/);
    expect(described).toMatch(/3 changes/);
  });

  test("leaves the count out when the commit carries no patches", () => {
    expect(describeCommit(commit({ patchCount: 0 }))).not.toMatch(/change/);
  });

  test("falls back to a placeholder for an empty message", () => {
    renderList(listOf(commit({ message: "   " })));
    expect(screen.getByRole("button", { name: /No message/ })).not.toBeNull();
  });
});

describe("when a page fails to load", () => {
  const failed: CommitListState = {
    status: "success",
    commits: [commit()],
    nextCursor: "cursor-1",
    loadingMore: false,
    loadMoreError: "The archive host is unreachable.",
  };

  // Failing to fetch page three is not a reason to take pages one and two
  // away, so this reports WITHOUT replacing the list.
  test("keeps the commits already read", () => {
    renderList(failed);
    expect(
      screen.getByRole("button", { name: /Fix the footer/ }),
    ).not.toBeNull();
  });

  test("says why, instead of the button silently doing nothing", () => {
    renderList(failed);
    expect(screen.getByText("The archive host is unreachable.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });

  test("hides the reason while a retry is in flight", () => {
    renderList({ ...failed, loadingMore: true });
    expect(screen.queryByText("The archive host is unreachable.")).toBeNull();
  });
});
