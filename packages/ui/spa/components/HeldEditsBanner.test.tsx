/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import {
  HeldEditsList,
  heldEditsOf,
  type HeldEditView,
} from "./HeldEditsBanner";
import { namedAction } from "./transientErrorActions";
import type { PatchRecord } from "../stores/types";

/*
 * Held edits ask the editor to make the change again where the field is now:
 * so they show what was written, to copy, and each is discarded on its own.
 * Every error offers what helps ("An error says what the person can do about
 * it").
 */
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const p1 = "p1" as PatchId;
const p2 = "p2" as PatchId;

const records: PatchRecord[] = [
  {
    patchId: p1,
    moduleFilePath: PAGE,
    patch: [{ op: "replace", path: ["heading"], value: "Spring sale" }],
  },
  {
    patchId: p2,
    moduleFilePath: PAGE,
    patch: [
      { op: "add", path: ["tags", "-"], value: { label: "New" } },
      { op: "remove", path: ["subtitle"] },
    ],
  },
];
const held = [
  { patchId: p1, moduleFilePath: PAGE, message: "Cannot replace: no heading" },
  { patchId: p2, moduleFilePath: PAGE, message: "Cannot add: no tags" },
];

test("what each held edit wrote, from its record", () => {
  expect(heldEditsOf(records, held)).toEqual([
    {
      patchId: p1,
      moduleFilePath: PAGE,
      changes: [
        { path: "heading", value: { kind: "text", text: "Spring sale" } },
      ],
      why: "Cannot replace: no heading",
    },
    {
      patchId: p2,
      moduleFilePath: PAGE,
      changes: [
        {
          path: "tags.-",
          value: { kind: "text", text: '{\n  "label": "New"\n}' },
        },
        { path: "subtitle", value: { kind: "removed" } },
      ],
      why: "Cannot add: no tags",
    },
  ]);
});

function shown(
  edits: HeldEditView[],
  discard: (
    ids: PatchId[],
  ) => Promise<
    { status: "discarded" } | { status: "failed"; message: string }
  > = async () => ({ status: "discarded" }),
) {
  const copied: string[] = [];
  const discarded: PatchId[][] = [];
  render(
    <HeldEditsList
      edits={edits}
      onDiscard={(ids) => {
        discarded.push(ids);
        return discard(ids);
      }}
      copy={(text) => copied.push(text)}
    />,
  );
  return { copied, discarded };
}

test("shows the value written, and copies it", () => {
  const { copied } = shown(heldEditsOf(records, held));
  expect(screen.getByText("Spring sale")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Copy what was written to heading" }),
  );
  expect(copied).toEqual(["Spring sale"]);
  expect(screen.getByText("Copied")).toBeTruthy();
});

test("each edit is discarded on its own, and all of them together", async () => {
  const { discarded } = shown(heldEditsOf(records, held));
  const each = screen.getAllByRole("button", { name: /Discard this edit/ });
  await act(async () => {
    fireEvent.click(each[1]);
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Discard all 2 edits" }),
    );
  });
  expect(discarded).toEqual([[p2], [p1, p2]]);
});

test("a discard that failed says why, keeps the edit, and Try again discards the same edit", async () => {
  let fail = true;
  const { discarded } = shown(heldEditsOf(records, held), async () =>
    fail
      ? { status: "failed", message: "Val could not be reached" }
      : { status: "discarded" },
  );
  await act(async () => {
    fireEvent.click(
      screen.getAllByRole("button", { name: /Discard this edit/ })[0],
    );
  });
  expect(
    screen.getByText(/Could not discard this edit: Val could not be reached\./),
  ).toBeTruthy();
  expect(screen.getByText("Spring sale")).toBeTruthy();
  fail = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
  });
  expect(discarded).toEqual([[p1], [p1]]);
  expect(screen.queryByText(/Could not discard/)).toBe(null);
});

test("a publish refused for them offers a button that brings the banner into view", () => {
  shown(heldEditsOf(records, held));
  const action = namedAction("show-held-edits");
  expect(action?.label).toBe("Show the edits");
  act(() => action?.onClick());
  expect(document.activeElement?.getAttribute("role")).toBe("alert");
});
