/**
 * @jest-environment jsdom
 */
import "./testPolyfills";
import { act, render } from "@testing-library/react";
import {
  computeSourcesSha,
  initVal,
  type ModuleFilePath,
  type PatchId,
} from "@valbuild/core";
import { createSystem, type System } from "../createSystem";
import type { PatchRecord } from "../types";
import { ValSystemProvider } from "./SystemContext";
import { ValOverlayEmitter } from "./ValOverlayEmitter";

jest.mock("../../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

/**
 * Publish a proposal, open the page in draft mode, reload it -- and it
 * flickered: the new text, then the old, then the new again.
 *
 * The server renders the draft from the build the publish made, so the page
 * starts right. The Studio's overlay then loads and starts from the source in
 * its BUNDLE, which can be the build from before the publish (the platform's
 * pointer lags, a cached script) until `BaseAlignment` has fetched the base the
 * server's chain belongs on. Whatever the overlay handed the page in between
 * was the old text, and the page showed it until the base caught up.
 *
 * So nothing goes to the page until the base is aligned: not a change, not
 * the snapshot of what is pending, and not `sources-synced`.
 */

const MODULE = "/content/home.val.ts" as ModuleFilePath;
const PENDING = "pending-1" as PatchId;

const OLD = { title: "Before the publish", subtitle: "Unchanged" };
const NEW = { title: "After the publish", subtitle: "Unchanged" };

const shaOf = (source: typeof OLD) =>
  computeSourcesSha([{ path: MODULE, source }]);

/** An edit still pending after the publish, on another field. */
const pending: PatchRecord = {
  patchId: PENDING,
  moduleFilePath: MODULE,
  patch: [{ op: "replace", path: ["subtitle"], value: "Edited" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  authorId: "someone",
  appliedAt: null,
};

type Sent =
  | { type: "source-update"; source: unknown }
  | { type: "sources-synced" };

function setup() {
  const { c, s } = initVal();
  let releaseBase: () => void = () => {};
  const baseGate = new Promise<void>((resolve) => {
    releaseBase = resolve;
  });
  const system: System = createSystem({
    // The build after the publish answers with its own source, once let.
    fetchBaseSources: async (sourcesSha) => {
      await baseGate;
      return sourcesSha === shaOf(NEW)
        ? { sourcesSha, sources: { [MODULE]: NEW } }
        : null;
    },
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
  // The bundle the overlay loaded: the build from before the publish.
  const modules = [
    c.define(
      MODULE,
      s.object({ title: s.string(), subtitle: s.string() }),
      OLD,
    ),
  ];
  const sent: Sent[] = [];
  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (typeof detail !== "object" || detail === null) return;
    if (!("type" in detail)) return;
    if (detail.type === "sources-synced") sent.push({ type: "sources-synced" });
    if (detail.type === "source-update" && "source" in detail) {
      sent.push({ type: "source-update", source: detail.source });
    }
  };
  window.addEventListener("val-event", listener);
  return {
    system,
    sent,
    intake: () => system.host.receive(modules),
    releaseBase: () => releaseBase(),
    cleanup: () => window.removeEventListener("val-event", listener),
  };
}

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

test("a draft page reloaded after a publish is never handed the text from before it", async () => {
  const { system, sent, intake, releaseBase, cleanup } = setup();
  render(
    <ValSystemProvider system={system}>
      <ValOverlayEmitter enabled />
    </ValSystemProvider>,
  );
  // As `ValStoreProvider` does: the modules, then `/stat`, which the build
  // after the publish answers.
  await act(async () => {
    intake();
    system.stat.receiveStat({
      patches: [PENDING],
      baseSha: "after-the-publish",
      sourcesSha: shaOf(NEW),
    });
  });
  // Longer than the emitter's debounce: the base is still being fetched.
  await wait(400);
  expect(sent).toEqual([]);

  releaseBase();
  await wait(400);

  const titles = sent.flatMap((message) =>
    message.type === "source-update" &&
    typeof message.source === "object" &&
    message.source !== null &&
    "title" in message.source
      ? [message.source.title]
      : [],
  );
  expect(titles).not.toContain(OLD.title);
  expect(sent).toContainEqual({ type: "sources-synced" });
  expect(sent).toContainEqual({
    type: "source-update",
    source: { title: NEW.title, subtitle: "Edited" },
  });
  // What the page is told is all of it comes after the content it is told.
  const synced = sent.findIndex((message) => message.type === "sources-synced");
  const update = sent.findIndex((message) => message.type === "source-update");
  expect(update).toBeLessThan(synced);
  cleanup();
});

test("a page the server never answers for is still handed the editor's changes", async () => {
  jest.useFakeTimers();
  try {
    const { system, sent, intake, cleanup } = setup();
    render(
      <ValSystemProvider system={system}>
        <ValOverlayEmitter enabled />
      </ValSystemProvider>,
    );
    // Intake, and no `/stat` at all.
    await act(async () => {
      intake();
    });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(sent).toEqual([]);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(sent).toContainEqual({ type: "sources-synced" });
    cleanup();
  } finally {
    jest.useRealTimers();
  }
});
