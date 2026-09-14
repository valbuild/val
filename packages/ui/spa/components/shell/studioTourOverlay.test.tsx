/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { StudioTour, TourLauncher, placeCard } from "./StudioTour";
import { EmptyEditorState } from "./EditorCanvas";
import { TopBar } from "./TopBar";
import { AccountPanel } from "./AccountPanel";
import { StudioSettingsFields } from "./SettingsPanel";
import { UtilityPanel } from "./UtilityPanel";
import { TourStep } from "./tourSteps";

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

  // Once it has been taken the button stays and goes quiet. A control that
  // vanishes is one nobody can find again on purpose.
  test("goes quiet rather than away", () => {
    render(<TourLauncher onStart={() => undefined} glow={false} />);
    const button = screen.getByLabelText("Take a tour of the Studio");
    expect(button.className).not.toContain("animate-tour-glow");
  });
});

/**
 * The empty editor at `/val/~` is the first thing anybody sees, and one of the
 * two places the tour is offered from. The other is Quick actions.
 */
describe("the empty editor", () => {
  test("offers the tour, glowing while it is still new", () => {
    const onStartTour = jest.fn();
    render(<EmptyEditorState onStartTour={onStartTour} tourPrompt />);
    const button = screen.getByLabelText("Take a tour of the Studio");
    expect(button.className).toContain("motion-safe:animate-tour-glow");
    fireEvent.click(button);
    expect(onStartTour).toHaveBeenCalled();
  });

  test("keeps it, quietly, once it has been taken", () => {
    render(
      <EmptyEditorState onStartTour={() => undefined} tourPrompt={false} />,
    );
    expect(
      screen.getByLabelText("Take a tour of the Studio").className,
    ).not.toContain("animate-tour-glow");
  });

  /**
   * It names the destinations this project HAS. Explaining Pages to a project
   * with no router sends somebody looking for an icon that is not in the rail —
   * which is the complaint this screen exists to answer, made worse.
   */
  test("defines only the destinations this project has", () => {
    render(<EmptyEditorState destinations={["data"]} />);
    expect(screen.queryByText("Data")).not.toBeNull();
    expect(screen.queryByText("Pages")).toBeNull();
    expect(screen.queryByText("Media")).toBeNull();
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

describe("the top bar", () => {
  /**
   * The top bar is Review, Preview and Publish — the controls for shipping a
   * change. A permanent onboarding button among them is clutter for everyone
   * who has already read it once, so the offer lives on the empty editor and
   * in Quick actions instead.
   */
  test("carries no tour button", () => {
    render(topBar({ onCompare: () => undefined }));
    expect(screen.queryByLabelText("Take a tour of the Studio")).toBeNull();
    expect(screen.queryByText("Take a tour")).toBeNull();
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
 * The Account panel runs the tour but does not decide whether it is offered.
 *
 * That decision is the project's, in `s.settings()` under `studio.tour` — see
 * `StudioSettingsFields`. A team that finds the tour noisy turns it off once,
 * for everyone, instead of each person dismissing it on each machine they use.
 */
describe("the account panel", () => {
  test("keeps a way to run the tour", () => {
    const onStartTour = jest.fn();
    render(accountPanel({ onStartTour }));
    fireEvent.click(screen.getByText("Take a tour"));
    expect(onStartTour).toHaveBeenCalled();
  });

  test("holds no setting for whether it is offered", () => {
    render(accountPanel({ onStartTour: () => undefined }));
    expect(screen.queryByText(/Offer the tour/)).toBeNull();
  });
});

/**
 * The project's own switch: one place, and it is content — published with
 * everything else, and the same for the whole team.
 */
describe("the project's tour setting", () => {
  function studio(props: Partial<Parameters<typeof StudioSettingsFields>[0]>) {
    return (
      <StudioSettingsFields
        value={{ tour: null }}
        onChange={() => undefined}
        {...props}
      />
    );
  }

  // Unset reads as on, and says which "on" it is: nobody has decided, and the
  // offer stands. The same shape `assistant.enabled` uses.
  test("unset draws as on", () => {
    render(studio({}));
    expect(
      screen
        .getByRole("switch", { name: /Offer the tour/ })
        .getAttribute("data-state"),
    ).toBe("checked");
  });

  test("turns off for the whole project", () => {
    const onChange = jest.fn();
    render(studio({ value: { tour: true }, onChange }));
    fireEvent.click(screen.getByRole("switch", { name: /Offer the tour/ }));
    expect(onChange).toHaveBeenCalledWith("tour", false);
  });

  // And says where the tour has gone, so turning it off is not mistaken for
  // deleting it.
  test("says the tour is still in Quick actions when it is off", () => {
    render(studio({ value: { tour: false } }));
    expect(screen.queryByText(/Quick actions/)).not.toBeNull();
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
