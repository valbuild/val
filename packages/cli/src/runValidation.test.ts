import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import path from "path";
import fs from "fs";
import {
  DEFAULT_VAL_REMOTE_HOST,
  type ModuleFilePath,
  type ModulePath,
} from "@valbuild/core";
import { createService } from "@valbuild/server";
import {
  createDefaultValFSHost,
  runValidation,
  ValidationEvent,
  IValRemote,
} from "./runValidation";

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");

const mockRemote: IValRemote = {
  remoteHost: DEFAULT_VAL_REMOTE_HOST,
  getSettings: async () => {
    throw new Error("Not expected to be called");
  },
  uploadFile: async () => {
    throw new Error("Not expected to be called");
  },
};

describe("runValidation", () => {
  let tmpDir: string;

  beforeEach(() => {
    const tmpBase = path.join(__dirname, ".tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpBase, "runValidation-"));
    fs.cpSync(BASIC_FIXTURE, tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns summary-success for a valid module", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-valid.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-success" });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(0);
  });

  test("returns validation-error for a module with minLength violation", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-errors.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(1);
  });

  test("applies metadata fix for image without metadata", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: true,
      valFiles: ["content/basic-image.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-success" });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(0);
    expect(events.filter((e) => e.type === "fix-applied")).toHaveLength(1);
    expect(events.find((e) => e.type === "fix-applied")).toMatchObject({
      type: "fix-applied",
      sourcePath: "/content/basic-image.val.ts",
    });
  });

  test("reports fixable error for image without metadata when fix is false", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-image.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    const fixableErrors = events.filter(
      (e) => e.type === "validation-fixable-error",
    );
    expect(fixableErrors).toHaveLength(1);
    expect(fixableErrors[0]).toMatchObject({
      type: "validation-fixable-error",
      sourcePath: "/content/basic-image.val.ts",
      fixable: true,
    });
  });

  test("handles module with both s.image and s.images", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-image-from-gallery.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }
    const lastEvent = events.at(-1);
    expect(["summary-success", "summary-errors"]).toContain(lastEvent?.type);
  });

  test("handles module with two gallery val files", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: [
        "content/basic-image-from-galleries.val.ts",
        "content/basic-gallery.val.ts",
        "content/basic-gallery-2.val.ts",
      ],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    const lastEvent = events.at(-1);
    expect(["summary-success", "summary-errors"]).toContain(lastEvent?.type);
  });

  test("basic-gallery-fail-on-non-unique-dir returns error for duplicate directory", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: [
        "content/basic-gallery.val.ts",
        "content/basic-gallery-fail-on-non-unique-dir.val.ts",
      ],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      type: "summary-errors",
      count: expect.any(Number),
    });
    const errors = events.filter((e) => e.type === "validation-error");
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(
        (e) =>
          "message" in e &&
          (e.message as string).includes("/public/val/images"),
      ),
    ).toBe(true);
  });

  test("returns validation-error for s.files gallery with untracked file in directory", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-files.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      type: "summary-errors",
      count: expect.any(Number),
    });
    const errors = events.filter((e) => e.type === "validation-error");
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(
        (e) => "message" in e && (e.message as string).includes("untracked.txt"),
      ),
    ).toBe(true);
  });

  test("returns validation-error for gallery with tracked file missing from disk", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-gallery-missing-tracked.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      type: "summary-errors",
      count: expect.any(Number),
    });
    const errors = events.filter((e) => e.type === "validation-error");
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(
        (e) =>
          "message" in e && (e.message as string).includes("missing.png"),
      ),
    ).toBe(true);
  });

  test("removes missing tracked file entry from gallery when fix is true", async () => {
    const gen = runValidation({
      root: tmpDir,
      fix: true,
      valFiles: ["content/basic-gallery-missing-tracked.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    });
    let next = await gen.next();
    while (!next.done) {
      next = await gen.next();
    }

    const service = await createService(tmpDir, {}, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-gallery-missing-tracked.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { source: true, schema: true, validate: true },
      );
      expect(result.source).not.toHaveProperty(
        "/public/val/images4/missing.png",
      );
    } finally {
      service.dispose();
    }
  });

  test("returns validation-fixable-error for gallery with wrong stored metadata", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-gallery-wrong-metadata.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      type: "summary-errors",
      count: expect.any(Number),
    });
    const fixableErrors = events.filter(
      (e) => e.type === "validation-fixable-error",
    );
    expect(fixableErrors.length).toBeGreaterThan(0);
    expect(fixableErrors[0]).toMatchObject({
      type: "validation-fixable-error",
      fixable: true,
    });
  });

  test("fixes wrong metadata for gallery entry when fix is true", async () => {
    const gen = runValidation({
      root: tmpDir,
      fix: true,
      valFiles: ["content/basic-gallery-wrong-metadata.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    });
    let next = await gen.next();
    while (!next.done) {
      next = await gen.next();
    }

    const service = await createService(tmpDir, {}, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-gallery-wrong-metadata.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { source: true, schema: true, validate: true },
      );
      expect(result.source).toMatchObject({
        "/public/val/images3/image.png": {
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
      });
    } finally {
      service.dispose();
    }
  });

  test("image has metadata after applying fix", async () => {
    const gen = runValidation({
      root: tmpDir,
      fix: true,
      valFiles: ["content/basic-image.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    });
    // consume all events to apply fixes
    let next = await gen.next();
    while (!next.done) {
      next = await gen.next();
    }

    const service = await createService(tmpDir, {}, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-image.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { source: true, schema: true, validate: true },
      );
      // The schema always emits image:check-metadata when metadata exists
      // (actual metadata verification happens in the fix handler).
      // Verify no image:add-metadata errors remain (fix was applied):
      if (result.errors && result.errors.validation) {
        const allFixes = Object.values(result.errors.validation)
          .flat()
          .flatMap((e) => e.fixes ?? []);
        expect(allFixes).not.toContain("image:add-metadata");
      }
      expect(result.source).toMatchObject({
        metadata: {
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
      });
    } finally {
      service.dispose();
    }
  });
});
