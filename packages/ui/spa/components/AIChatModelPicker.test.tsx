/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { AIChatModelPicker } from "./AIChatModelPicker";
import type { AIModelInfo } from "../hooks/useAIWebSocket";

/**
 * The picker looked broken in two separate ways, and both are regressions worth
 * a test.
 *
 * It HID ITSELF for a single model, so an account with one reachable model got
 * no indication of which model was answering — and no clue that a picker
 * existed at all.
 *
 * And its menu was portalled to `document.body`, outside the Studio's shadow
 * root, where none of Val's styles reach it and nothing lifts it above the
 * overlay. Radix opened it; it was simply invisible, which reads as a dead
 * button. So the test asserts the menu lands INSIDE the container it was
 * given, not merely that it exists somewhere in the document.
 */

const SONNET: AIModelInfo = {
  ref: { provider: "anthropic", model: "claude-sonnet-5" },
  label: "Claude Sonnet 5",
};
const OPUS: AIModelInfo = {
  ref: { provider: "anthropic", model: "claude-opus-5" },
  label: "Claude Opus 5",
};

/**
 * Opened with the keyboard, not a click. Radix's trigger opens on
 * `pointerdown`, and jsdom has no pointer events to dispatch — so the keyboard
 * path is the one a test can drive, and it is the same open.
 */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

/**
 * The portal nodes this file has made.
 *
 * They are appended to `document.body`, which Testing Library's cleanup does
 * not touch — it unmounts the roots it created and nothing else. Left alone
 * they accumulate one empty `div` per test, in the tree every `screen` query
 * searches. Removed here so each test starts in the body it expects.
 */
const portalContainers: HTMLElement[] = [];

afterEach(() => {
  for (const node of portalContainers.splice(0)) {
    node.remove();
  }
});

function renderPicker(
  models: AIModelInfo[],
  onSelectModel: (model: AIModelInfo["ref"]) => void = () => {},
  withContainer = true,
) {
  const portalContainer = document.createElement("div");
  document.body.appendChild(portalContainer);
  portalContainers.push(portalContainer);
  const rendered = render(
    <AIChatModelPicker
      models={models}
      selectedModel={models[0]?.ref ?? null}
      onSelectModel={onSelectModel}
      portalContainer={withContainer ? portalContainer : null}
    />,
  );
  // Named, not spread alongside RTL's own `container` — that one is the render
  // root, and it would quietly shadow this one.
  return { portalContainer, ...rendered };
}

test("offers the picker for a single model", () => {
  renderPicker([SONNET]);
  expect(
    screen.getByRole("button", {
      name: "Change model, currently Claude Sonnet 5",
    }),
  ).toBeTruthy();
});

test("renders nothing when no model is on offer", () => {
  const { container } = renderPicker([]);
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.textContent).toBe("");
});

test("opens the menu inside the container it was given", () => {
  const { portalContainer } = renderPicker([SONNET, OPUS]);
  openMenu(
    screen.getByRole("button", {
      name: "Change model, currently Claude Sonnet 5",
    }),
  );
  const item = screen.getByRole("menuitem", { name: "Claude Opus 5" });
  expect(portalContainer.contains(item)).toBe(true);
});

test("reports the model that was chosen", () => {
  const chosen: AIModelInfo["ref"][] = [];
  renderPicker([SONNET, OPUS], (model) => chosen.push(model));
  openMenu(
    screen.getByRole("button", {
      name: "Change model, currently Claude Sonnet 5",
    }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Claude Opus 5" }));
  expect(chosen).toEqual([OPUS.ref]);
});

test("keeps the menu in the tree when there is no container yet", () => {
  // The portal node arrives a render late — `ValPortalProvider` holds it in
  // state and it is an element only after that provider's own commit — so the
  // picker can be opened in that window.
  // Rendering inline is the fallback `DropdownMenuContent` takes there, and it
  // beats portalling out of the shadow root and being invisible.
  const { container } = renderPicker([SONNET, OPUS], () => {}, false);
  openMenu(
    screen.getByRole("button", {
      name: "Change model, currently Claude Sonnet 5",
    }),
  );
  const item = screen.getByRole("menuitem", { name: "Claude Opus 5" });
  expect(container.contains(item)).toBe(true);
});
