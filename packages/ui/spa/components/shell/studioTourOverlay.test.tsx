/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { StudioTour, TourLauncher, placeCard } from "./StudioTour";
import { TopBar } from "./TopBar";
import { AccountPanel } from "./AccountPanel";
import { UtilityPanel } from "./UtilityPanel";
import { TourStep } from "./studioTour";

/**
 * The tour overlay: what it puts on screen, and what it does to the shell
 * around it.
 *
 * `Shell` itself is not renderable here — it pulls in the whole editor tree —
 * so the pieces are driven directly, the same way `tabletDestinations` drives
 * the panels.
 */
const steps: TourStep[] = [
  { id: "welcome", title: "Welcome", body: "The first thing." },
  {
    id: "pages",
    title: "Pages",
    body: "The second thing.",
    target: "pages",
    panel: "pages",
  },
  { id: "finish", title: "Done with it", body: "The last thing." },
];

function tour(props: Partial<Parameters<typeof StudioTour>[0]> = {}) {
  return (
    <StudioTour
      steps={steps}
      onClose={() => undefined}
      onOpenPanel={() => undefined}
      {...props}
    />
  );
}

describe("the studio tour", () => {
  test("starts at the first step and counts them", () => {
    render(tour());
    expect(screen.queryByText("Welcome")).not.toBeNull();
    expect(screen.queryByText("1 / 3")).not.toBeNull();
  });

  test("Next and Back walk the steps", () => {
    render(tour());
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByText("Pages")).not.toBeNull();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.queryByText("Welcome")).not.toBeNull();
  });

  // There is nowhere to go back to from the first step, and a control that
  // cannot do anything is one more thing to read.
  test("there is no Back on the first step", () => {
    render(tour());
    expect(screen.queryByText("Back")).toBeNull();
  });

  test("the last step finishes rather than advancing", () => {
    const onClose = jest.fn();
    render(tour({ onClose }));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByText("Done")).not.toBeNull();
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });

  test("the X leaves the tour", () => {
    const onClose = jest.fn();
    render(tour({ onClose }));
    fireEvent.click(screen.getByLabelText("Close the tour"));
    expect(onClose).toHaveBeenCalled();
  });

  test("Escape leaves the tour", () => {
    const onClose = jest.fn();
    render(tour({ onClose }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * The panel is the point of a destination step: the thing someone has to
   * recognise again tomorrow is the real Pages panel, not a picture of it.
   * And the steps that are not about a panel have to CLOSE whatever the last
   * one opened — otherwise the tour ends with a panel nobody opened.
   */
  test("each step opens the panel it is about, and closes it again after", () => {
    const onOpenPanel = jest.fn();
    render(tour({ onOpenPanel }));
    expect(onOpenPanel).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByText("Next"));
    expect(onOpenPanel).toHaveBeenLastCalledWith("pages");
    fireEvent.click(screen.getByText("Next"));
    expect(onOpenPanel).toHaveBeenLastCalledWith(null);
  });

  // A tour of nothing is not a tour. Guarding it here rather than at the call
  // site keeps a project with no destinations from rendering an empty card.
  test("no steps renders nothing at all", () => {
    const { container } = render(tour({ steps: [] }));
    expect(container.firstChild).toBeNull();
  });
});

/**
 * Where the card goes.
 *
 * Pure, because the interesting cases are about space that jsdom does not
 * have: a target at the very bottom of the shell, and one so far right that
 * a left-aligned card would hang off the edge.
 */
describe("placeCard", () => {
  const shell = { width: 1000, height: 800 };
  const card = { width: 296, height: 160 };

  test("below the target when there is room", () => {
    const at = placeCard(
      { top: 100, left: 60, width: 32, height: 32 },
      shell,
      card,
    );
    expect(at.top).toBeGreaterThan(132);
    expect(at.left).toBe(60);
  });

  test("above the target when there is not", () => {
    const at = placeCard(
      { top: 700, left: 60, width: 32, height: 32 },
      shell,
      card,
    );
    expect(at.top).toBeLessThan(700);
  });

  test("never off the right edge", () => {
    const at = placeCard(
      { top: 100, left: 960, width: 32, height: 32 },
      shell,
      card,
    );
    expect(at.left + card.width).toBeLessThanOrEqual(shell.width);
  });

  // No target is the phone case, and the case of a control this breakpoint
  // does not draw: the card is simply in the middle rather than in a corner.
  test("centred when there is nothing to point at", () => {
    const at = placeCard(null, shell, card);
    expect(at.left).toBe((shell.width - card.width) / 2);
    expect(at.top).toBe((shell.height - card.height) / 2);
  });

  /**
   * The step that opens a panel must not cover it. The spotlight is a 32px rail
   * icon at the left edge, so "below the target" is squarely on top of the
   * panel that just slid out — the tour was telling people to look at something
   * it was hiding.
   */
  const panel = { top: 64, left: 76, width: 300, height: 600 };

  test("steps aside for the panel it just opened", () => {
    const at = placeCard(
      { top: 100, left: 12, width: 32, height: 32 },
      shell,
      card,
      panel,
    );
    expect(at.left).toBeGreaterThanOrEqual(panel.left + panel.width);
  });

  test("stays where it was when it was never in the way", () => {
    const target = { top: 100, left: 600, width: 80, height: 32 };
    expect(placeCard(target, shell, card, panel)).toEqual(
      placeCard(target, shell, card),
    );
  });

  /**
   * A phone: the sheet is most of the screen, so there is no "beside" to move
   * to. Overlapping is then better than hanging off the edge, where the card's
   * own buttons would be unreachable.
   */
  test("rather overlaps than goes off the screen", () => {
    const phone = { width: 390, height: 780 };
    const sheet = { top: 0, left: 0, width: 340, height: 780 };
    const at = placeCard(null, phone, { width: 296, height: 200 }, sheet);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + 296).toBeLessThanOrEqual(phone.width);
  });
});

describe("the tour launcher", () => {
  test("starts the tour", () => {
    const onStart = jest.fn();
    render(<TourLauncher onStart={onStart} />);
    fireEvent.click(screen.getByLabelText("Take a tour of the Studio"));
    expect(onStart).toHaveBeenCalled();
  });

  // The glow is the whole offer: a tour nobody is told about is a tour nobody
  // takes. It is behind `motion-safe:` so a reduced-motion browser gets a
  // still button rather than no button.
  test("glows, and only where motion is welcome", () => {
    render(<TourLauncher onStart={() => undefined} />);
    const button = screen.getByLabelText("Take a tour of the Studio");
    expect(button.className).toContain("motion-safe:animate-tour-glow");
  });
});

function topBar(props: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return (
    <TopBar
      breakpoint="desktop"
      projectName="demo"
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      onPublish={() => undefined}
      pendingChanges={0}
      {...props}
    />
  );
}

describe("the top bar's offer", () => {
  test("carries the launcher when the tour is still worth offering", () => {
    render(topBar({ onStartTour: () => undefined }));
    expect(screen.queryByLabelText("Take a tour of the Studio")).not.toBeNull();
  });

  /**
   * Gone once it has been taken — this is what "never be annoying" comes down
   * to. The tour itself stays reachable from Quick actions and the Account
   * panel; what goes is the thing that shines.
   */
  test("has no launcher once the tour has been taken", () => {
    render(topBar());
    expect(screen.queryByLabelText("Take a tour of the Studio")).toBeNull();
  });

  test("the controls the tour points at are marked", () => {
    const { container } = render(
      topBar({ onCompare: () => undefined, onToggleCanvas: () => undefined }),
    );
    for (const target of ["review", "preview", "publish", "utility"]) {
      expect(
        container.querySelector(`[data-val-tour="${target}"]`),
      ).not.toBeNull();
    }
  });
});

function accountPanel(props: Partial<Parameters<typeof AccountPanel>[0]> = {}) {
  return (
    <AccountPanel
      breakpoint="desktop"
      theme="dark"
      onThemeChange={() => undefined}
      autoSave={false}
      onAutoSaveChange={() => undefined}
      onClose={() => undefined}
      {...props}
    />
  );
}

/**
 * The setting, and why it is in the Account panel: it is per-browser, like the
 * theme and Auto save beside it. The Settings panel is `s.settings()` content
 * — published, and the same for everyone on the team.
 */
describe("the tour setting", () => {
  test("is on unless it has been turned off", () => {
    render(accountPanel({ onTourEnabledChange: () => undefined }));
    const toggle = screen.getByRole("checkbox", { name: /Offer the tour/ });
    expect(toggle.getAttribute("data-state")).toBe("checked");
  });

  test("reports being turned off", () => {
    const onTourEnabledChange = jest.fn();
    render(accountPanel({ tourEnabled: true, onTourEnabledChange }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Offer the tour/ }));
    expect(onTourEnabledChange).toHaveBeenCalledWith(false);
  });

  test("keeps a way to run the tour even with the offer turned off", () => {
    const onStartTour = jest.fn();
    render(
      accountPanel({
        tourEnabled: false,
        onTourEnabledChange: () => undefined,
        onStartTour,
      }),
    );
    fireEvent.click(screen.getByText("Take a tour"));
    expect(onStartTour).toHaveBeenCalled();
  });
});

/**
 * Quick actions is the tour's permanent home — the top bar's launcher is a
 * one-time offer, and the tour's own last step sends people here.
 */
describe("the tour in quick actions", () => {
  function panel(props: Partial<Parameters<typeof UtilityPanel>[0]> = {}) {
    return (
      <UtilityPanel
        breakpoint="desktop"
        activity={[]}
        onNewPage={() => undefined}
        onUploadMedia={() => undefined}
        onClose={() => undefined}
        onSelectActivity={() => undefined}
        pendingChanges={0}
        {...props}
      />
    );
  }

  test("offers the tour", () => {
    const onStartTour = jest.fn();
    render(panel({ onStartTour }));
    fireEvent.click(screen.getByText("Take a tour"));
    expect(onStartTour).toHaveBeenCalled();
  });

  test("says nothing about it where there is no tour to run", () => {
    render(panel());
    expect(screen.queryByText("Take a tour")).toBeNull();
  });
});
