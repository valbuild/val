/**
 * @jest-environment jsdom
 */
import "../../../stores/react/testPolyfills";
import { act, render } from "@testing-library/react";
import {
  computeSourcesSha,
  initVal,
  type ModuleFilePath,
  type PatchId,
} from "@valbuild/core";
import {
  VAL_CANVAS_MESSAGE,
  isValCanvasStudioMessage,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { createSystem, type System } from "../../../stores/createSystem";
import type { PatchRecord } from "../../../stores/types";
import { ValSystemProvider } from "../../../stores/react/SystemContext";
import { CanvasFrame } from "./CanvasFrame";

jest.mock("../../../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

/**
 * What the canvas tells the page it frames, in order, with the Studio's real
 * stores behind it: the modules it has changes for -- and the ones the page
 * says it holds a draft of -- then `sourcesSynced`, then `confirmed` with
 * the server's `seq`, and again each time the server moves.
 *
 * The overlay's relay is driven end to end by the scenarios (S05, S24b,
 * B08 in `scenarios/`); the canvas is the same catch-up (`startCatchUp`)
 * over `postMessage`, which the scenario world does not model, so its
 * messages are pinned here.
 */

const PENDING_MODULE = "/content/home.val.ts" as ModuleFilePath;
const HELD_MODULE = "/content/about.val.ts" as ModuleFilePath;
const PENDING = "pending-1" as PatchId;
const HOME = { title: "Home" };
const ABOUT = { title: "About" };

const pending: PatchRecord = {
  patchId: PENDING,
  moduleFilePath: PENDING_MODULE,
  patch: [{ op: "replace", path: ["title"], value: "Edited" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "someone",
  appliedAt: null,
};

function setup() {
  const { c, s } = initVal();
  const system: System = createSystem({
    fetchBaseSources: async () => null,
    fetchPatches: async (patchIds) => ({
      patches: patchIds.includes(PENDING) ? [pending] : [],
    }),
    createPatchId: () => "local-1" as PatchId,
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    publishPatches: async () => ({ status: "published" }),
  });
  const modules = [
    c.define(PENDING_MODULE, s.object({ title: s.string() }), HOME),
    c.define(HELD_MODULE, s.object({ title: s.string() }), ABOUT),
  ];
  const sourcesSha = computeSourcesSha([
    { path: PENDING_MODULE, source: HOME },
    { path: HELD_MODULE, source: ABOUT },
  ]);
  return { system, modules, sourcesSha };
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

test("the canvas is caught up, told it has everything, then told what the server confirmed", async () => {
  const { system, modules, sourcesSha } = setup();
  const rendered = render(
    <ValSystemProvider system={system}>
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
      />
    </ValSystemProvider>,
  );
  const frame = rendered.container.querySelector("iframe");
  const target = frame?.contentWindow;
  if (!frame || !target) throw new Error("the frame did not render");
  const posted: ValCanvasStudioMessage[] = [];
  jest.spyOn(target, "postMessage").mockImplementation((message: unknown) => {
    if (isValCanvasStudioMessage(message)) posted.push(message);
  });
  await act(async () => {
    system.host.receive(modules);
    system.stat.receiveStat({
      patches: [PENDING],
      baseSha: "base",
      sourcesSha,
      seq: 5,
    });
  });
  // The page announces itself, saying it holds a draft of the other module.
  const ready: ValCanvasPageMessage = {
    val: VAL_CANVAS_MESSAGE,
    type: "ready",
    draftMode: true,
    url: "http://localhost/",
    holds: [HELD_MODULE],
  };
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { source: target, data: ready }),
    );
  });
  await settle();

  const told = posted.flatMap((message) =>
    message.type === "sourceUpdate"
      ? [`update ${message.moduleFilePath}`]
      : message.type === "sourcesSynced"
        ? ["synced"]
        : message.type === "confirmed"
          ? [`confirmed ${message.seq}`]
          : [],
  );
  expect(told.slice(-2)).toEqual(["synced", "confirmed 5"]);
  expect(told).toContain(`update ${PENDING_MODULE}`);
  expect(told).toContain(`update ${HELD_MODULE}`);

  // The server moves on: another stat, at a later `seq`.
  await act(async () => {
    system.stat.receiveStat({
      patches: [PENDING],
      baseSha: "base",
      sourcesSha,
      seq: 6,
    });
  });
  await settle();
  const confirmed = posted.flatMap((message) =>
    message.type === "confirmed" ? [message.seq] : [],
  );
  expect(confirmed).toEqual([5, 6]);
  jest.restoreAllMocks();
});
