/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FloatingNotices,
  FoldedNoticeChip,
  type FloatingNoticeItem,
} from "./FloatingNotices";

/*
 * A notice about where the Studio is pops up from below and stays until it is
 * dismissed; dismissed, it folds into the status bar, and comes back from
 * there. Nothing about it is lost by dismissing it.
 */

const upgrade: FloatingNoticeItem = {
  id: "upgrade:e5f6:staged:false",
  label: "About this upgrade",
  icon: null,
  content: <section>This proposal upgrades Val 0.149.4 → 0.149.7</section>,
};

test("each notice has its own dismiss, naming it", () => {
  const onDismiss = jest.fn();
  render(<FloatingNotices notices={[upgrade]} onDismiss={onDismiss} />);
  expect(screen.getByText(/This proposal upgrades Val/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss: About this upgrade" }),
  );
  expect(onDismiss).toHaveBeenCalledWith("upgrade:e5f6:staged:false");
});

test("nothing to show renders nothing", () => {
  const { container } = render(
    <FloatingNotices notices={[]} onDismiss={() => {}} />,
  );
  expect(container.innerHTML).toBe("");
});

test("folded, it is named in the status bar and brings the notice back", () => {
  const onOpen = jest.fn();
  render(<FoldedNoticeChip notice={upgrade} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "About this upgrade" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});
