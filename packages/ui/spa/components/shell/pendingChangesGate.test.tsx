/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  PENDING_CHANGES_DEADLINE_MS,
  PendingChangesGate,
} from "./PendingChangesGate";
import { usePendingWriteHold } from "../PendingWriteHold";
import { ChainProgress } from "../../utils/describePendingChangesStall";

/**
 * The wait, and the two ways out of it.
 *
 * The gate held the fields behind a spinner with no deadline and no dismiss: for
 * one chain it never released, and the only recovery anyone found was to delete
 * every patch on the server. It also held the whole editor `inert`, which took
 * out everything in it that merely navigates — so the way out of a stuck editor
 * was not reachable from inside it either.
 */
const STUCK: ChainProgress = {
  total: 3,
  settled: 1,
  unfetched: ["p2", "p3"],
  unapplied: [],
  failed: [],
  statSeen: true,
};

/** Reports the hold the fields would see. */
function Probe() {
  return <span data-testid="hold">{String(usePendingWriteHold())}</span>;
}

function gate(ready: boolean) {
  return (
    <PendingChangesGate
      ready={ready}
      progress={() => STUCK}
      fetchError="Failed to fetch"
    >
      <Probe />
      <a href="/somewhere">a link that only navigates</a>
    </PendingChangesGate>
  );
}

function hold(): string {
  return screen.getByTestId("hold").textContent ?? "";
}

describe("the pending-changes gate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("holds writing while it waits, and says so", () => {
    render(gate(false));
    expect(hold()).toBe("true");
    expect(screen.getByText("Loading unpublished changes…")).not.toBeNull();
  });

  test("releases writing once the changes are in", () => {
    const { rerender } = render(gate(false));
    rerender(gate(true));
    expect(hold()).toBe("false");
    expect(screen.queryByText("Loading unpublished changes…")).toBeNull();
  });

  test("holds writing without taking out what only navigates", () => {
    render(gate(false));
    // The hold is a flag the fields read, not `inert` on the subtree: a link in
    // here is still a link. `inert` would have removed it from the a11y tree.
    expect(
      screen.getByRole("link", { name: "a link that only navigates" }),
    ).not.toBeNull();
  });

  test("can be dismissed, which releases the hold", () => {
    render(gate(false));
    fireEvent.click(
      screen.getByLabelText("Stop waiting for unpublished changes"),
    );
    expect(hold()).toBe("false");
    expect(screen.queryByText("Loading unpublished changes…")).toBeNull();
  });

  test("turns into a report at the deadline, naming what did not arrive", () => {
    render(gate(false));
    act(() => {
      jest.advanceTimersByTime(PENDING_CHANGES_DEADLINE_MS);
    });

    // No longer a spinner, and no longer holding: at this point refusing to let
    // someone work is worse than letting them work with a warning.
    expect(screen.queryByText("Loading unpublished changes…")).toBeNull();
    expect(hold()).toBe("false");

    expect(screen.getByRole("alert").textContent).toContain("never arrived");
    // The diagnostics, folded away but present.
    expect(screen.getByText("Diagnostics")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("p2, p3");
    expect(screen.getByRole("alert").textContent).toContain("Failed to fetch");
  });

  test("the report can be dismissed too", () => {
    render(gate(false));
    act(() => {
      jest.advanceTimersByTime(PENDING_CHANGES_DEADLINE_MS);
    });
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("no report when the changes land before the deadline", () => {
    const { rerender } = render(gate(false));
    act(() => {
      jest.advanceTimersByTime(PENDING_CHANGES_DEADLINE_MS - 1000);
    });
    rerender(gate(true));
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(hold()).toBe("false");
  });
});
