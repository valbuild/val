/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { type ReactNode } from "react";
import { createSystem, type System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import * as references from "./getReferencedFiles";
import { useReferencedFiles } from "./useReferencedFiles";

/**
 * The gallery inspector's "Used in" is worked out after the inspector has
 * painted, not on the click that opens it.
 *
 * The scan walks the whole project, and it ran in the inspector's first
 * render: at 10,000 posts that pick an image it was most of the one long task
 * (127-154 ms) left when "used by" was opened on a built Studio
 * (`scenarios/measure/results.md`, "The Studio, built"). Until it has run the
 * answer is not `success`, because Delete and Rename are gated on it: no
 * references found is only true once somebody has looked.
 *
 * The real scan, counted where it runs: the module is wrapped, not replaced.
 */
jest.mock("./getReferencedFiles", () => {
  const actual = jest.requireActual("./getReferencedFiles");
  return {
    ...actual,
    getReferencedFiles: jest.fn(actual.getReferencedFiles),
  };
});
const scans = jest.mocked(references.getReferencedFiles);

const GALLERY = "/images.val.ts" as ModuleFilePath;
const PAGE = "/page.val.ts" as ModuleFilePath;
const PHOTO = "/public/val/images/photo.png";

function testSystem(): System {
  const { c, s } = initVal();
  const galleryVal = c.define(GALLERY, s.imagedir("/public/val/images"), {
    [PHOTO]: { width: 1, height: 1, mimeType: "image/png", alt: null },
  });
  const pageVal = c.define(PAGE, s.object({ hero: s.image(galleryVal) }), {
    hero: { path: PHOTO },
  });
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p1" as PatchId,
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    publishPatches: async () => ({ status: "published" }),
    discardPatches: async (patchIds) => ({ status: "discarded", patchIds }),
    deferPendingValidation: () => () => {},
  });
  system.host.receive([galleryVal, pageVal]);
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return system;
}

describe("useReferencedFiles", () => {
  let system: System;
  beforeEach(() => {
    scans.mockClear();
    system = testSystem();
  });
  afterEach(() => {
    system.dispose();
  });

  it("scans after the first paint, and is not checked until it has", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ValSystemProvider system={system}>{children}</ValSystemProvider>
    );
    const { result } = renderHook(() => useReferencedFiles(GALLERY, PHOTO), {
      wrapper,
    });

    // The first render: nothing walked, and nothing claimed.
    expect(scans).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
    expect(result.current.refs).toEqual([]);

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.refs).toEqual([
      '/page.val.ts?p="hero"' as SourcePath,
    ]);
    // Once, however many renders it took to get there.
    await act(async () => {});
    expect(scans).toHaveBeenCalledTimes(1);
  });
});
