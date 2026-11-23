/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { Shell, type ShellSelection } from "./Shell";
import { mockSelectionIds, mockShellData } from "./mockShellData";
import { TooltipProvider } from "../designSystem/tooltip";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValThemeProvider } from "../ValThemeProvider";
import type { ShellActivityEntry } from "./types";

// The worker behind validation, which jest cannot load; nothing here validates.
jest.mock("../../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

// ESM-only, which this jest setup does not transform.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

/**
 * A field write does not render the shell.
 *
 * What a write moves in the shell is four words of its chrome: whether the
 * write is saved yet, how many changes are pending, how many Review counts,
 * and Recent activity. They were props of the one component that renders
 * everything, so each write rendered the rail, the bars, every panel, the
 * editor and the canvas -- about 1,500 components, nine times over
 * (`docs/plans/studio-write-lag.md`).
 *
 * `Shell` takes them as the same props, and now hands them to a store that
 * the components showing them read (`ShellLive.tsx`); the rest is a `memo`.
 * So this renders the shell, moves each of those props as a write does, and
 * counts renders of the editor it was handed -- which the frame renders, and
 * which nothing about a write should reach.
 */
beforeAll(() => {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 1440,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  Element.prototype.scrollIntoView = () => {};
  // jsdom has no layout, and the panes measure themselves.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

type ShellProps = ComponentProps<typeof Shell>;

let editorRenders = 0;
/** The editor the app hands the shell: rendered by the frame. */
function Editor() {
  editorRenders += 1;
  return <div>The editor</div>;
}
// Made once, as the app's are while it does not render: a new function here
// would be a new prop of the frame, and the frame would be right to render.
const renderEditor = (_selection: ShellSelection): ReactNode => <Editor />;
const onThemeChange = () => undefined;
const setTheme = () => {};

function shell(live: Partial<ShellProps> = {}) {
  return (
    <ValThemeProvider theme="dark" setTheme={setTheme} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <Shell
            data={mockShellData}
            theme="dark"
            onThemeChange={onThemeChange}
            initialSelectionId={mockSelectionIds.home}
            renderEditor={renderEditor}
            saveState="saved"
            pendingChanges={0}
            skipTransition
            {...live}
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

/** The label of the save state that is showing. See `saveIndicator.test.tsx`. */
function shownSaveLabels(): string[] {
  return ["All changes saved", "Saving…", "Could not save"].filter((label) =>
    screen
      .queryAllByText(label)
      .some(
        (element) =>
          element.closest("[aria-hidden]")?.getAttribute("aria-hidden") ===
          "false",
      ),
  );
}

beforeEach(() => {
  editorRenders = 0;
});

test("the save state moving does not render the frame, and the status bar shows it", () => {
  const view = render(shell());
  expect(shownSaveLabels()).toEqual(["All changes saved"]);
  const before = editorRenders;
  expect(before).toBeGreaterThan(0);

  view.rerender(shell({ saveState: "saving" }));
  expect(shownSaveLabels()).toEqual(["Saving…"]);
  view.rerender(shell({ saveState: "saved" }));
  expect(shownSaveLabels()).toEqual(["All changes saved"]);
  expect(editorRenders).toBe(before);
});

test("the pending and review counts moving do not render the frame, and Review shows them", () => {
  const view = render(shell({ onCompare: onThemeChange }));
  const before = editorRenders;

  view.rerender(shell({ onCompare: onThemeChange, pendingChanges: 3 }));
  expect(screen.queryByRole("button", { name: /Review.*3/ })).not.toBeNull();
  view.rerender(
    shell({ onCompare: onThemeChange, pendingChanges: 4, reviewCount: 2 }),
  );
  expect(screen.queryByRole("button", { name: /Review.*2/ })).not.toBeNull();
  expect(editorRenders).toBe(before);
});

test("Recent activity moving does not render the frame", () => {
  const view = render(shell());
  const before = editorRenders;
  const activity: ShellActivityEntry[] = [
    ...(mockShellData.activity ?? []),
    {
      kind: "change",
      id: "another",
      title: "Another change",
      sourcePath: '/content/home.val.ts?p="title"',
      timestamp: "just now",
    },
  ];
  view.rerender(shell({ data: { ...mockShellData, activity } }));
  view.rerender(
    shell({ data: { ...mockShellData, activity, pendingChanges: 9 } }),
  );
  expect(editorRenders).toBe(before);
});

test("what a write does not move still renders the frame when it changes", () => {
  const view = render(shell());
  const before = editorRenders;
  // The guard on the guard: a frame that never rendered would pass the tests
  // above for the wrong reason.
  view.rerender(
    shell({ data: { ...mockShellData, projectName: "Another project" } }),
  );
  expect(editorRenders).toBeGreaterThan(before);
});
