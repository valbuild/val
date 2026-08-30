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
        (e) =>
          "message" in e && (e.message as string).includes("untracked.txt"),
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
        (e) => "message" in e && (e.message as string).includes("missing.png"),
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

    const service = await createService(tmpDir, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-gallery-missing-tracked.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { validate: true },
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

    const service = await createService(tmpDir, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-gallery-wrong-metadata.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { validate: true },
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

    const service = await createService(tmpDir, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-image.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { validate: true },
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
      // The fix writes the fields it read from the bytes next to `path`.
      expect(result.source).toMatchObject({
        path: "/public/val/image.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      });
    } finally {
      service.dispose();
    }
  });

  test("reports upload-remote error for local entry in a remote gallery", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-gallery-remote.val.ts"],
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
    expect(
      errors.some(
        (e) =>
          "message" in e &&
          (e.message as string).includes("needs to be uploaded"),
      ),
    ).toBe(true);
  });

  test("uploads local entry in a remote gallery and rewrites the key when fix is true", async () => {
    const uploadRemote: IValRemote = {
      remoteHost: DEFAULT_VAL_REMOTE_HOST,
      getSettings: async () => ({
        success: true,
        data: {
          publicProjectId: "pubproj",
          remoteFileBuckets: [{ bucket: "01" }],
        },
      }),
      uploadFile: async () => ({ success: true }),
    };
    // Upload requires a personal access token on disk.
    fs.mkdirSync(path.join(tmpDir, ".val"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".val", "pat.json"),
      JSON.stringify({ pat: "test-pat" }),
    );

    const events: ValidationEvent[] = [];
    for await (const event of runValidation({
      root: tmpDir,
      fix: true,
      valFiles: ["content/basic-gallery-remote.val.ts"],
      project: "test/project",
      remote: uploadRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "remote-uploaded")).toBe(true);
    expect(events.some((e) => e.type === "fix-applied")).toBe(true);

    const service = await createService(tmpDir, createDefaultValFSHost());
    try {
      const result = await service.get(
        "/content/basic-gallery-remote.val.ts" as ModuleFilePath,
        "" as ModulePath,
        { validate: false },
      );
      const source = result.source as Record<string, unknown>;
      // The local-path key is replaced by a remote URL key (file kept on disk).
      expect(source).not.toHaveProperty("/public/val/images-remote/image.png");
      const keys = Object.keys(source);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain("pubproj");
      expect(keys[0]).toContain("public/val/images-remote/image.png");
    } finally {
      service.dispose();
    }
  });

  test("does not flag a kept-on-disk file behind a remote gallery key", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-gallery-remote-existing.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    // The file kept on disk under the remote URL key must not be reported as
    // untracked, and the remote URL key must not be reported as missing.
    expect(events.at(-1)).toEqual({ type: "summary-success" });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(0);
  });

  describe("unregistered files", () => {
    const runOn = async (valFiles: string[]) => {
      const events: ValidationEvent[] = [];
      for await (const event of runValidation({
        root: tmpDir,
        fix: false,
        valFiles,
        project: undefined,
        remote: mockRemote,
        fs: createDefaultValFSHost(),
      })) {
        events.push(event);
      }
      return events;
    };

    test("warns about an unregistered file that IS a Val module", async () => {
      const events = await runOn(["content/unregistered-module.val.ts"]);

      expect(events).toEqual(
        expect.arrayContaining([
          {
            type: "unregistered-module",
            file: "content/unregistered-module.val.ts",
          },
        ]),
      );
      expect(events.at(-1)).toEqual({ type: "summary-success" });
    });

    test("says nothing about an unregistered file with no default export", async () => {
      // The `.val.ts` suffix is used for shared schemas and other helpers too.
      // Those are not meant to be registered, so warning about them buried the
      // one warning that matters under a wall of noise.
      const events = await runOn(["content/unregistered-helper.val.ts"]);

      expect(events.filter((e) => e.type !== "summary-success")).toHaveLength(
        0,
      );
      expect(events.at(-1)).toEqual({ type: "summary-success" });
    });

    test("says nothing about a type-only default export", async () => {
      // `export type { T as default }` does not survive transpilation, so the
      // file has no runtime default export - evaluating it would report a pure
      // helper as an error.
      const events = await runOn(["content/unregistered-type-default.val.ts"]);

      expect(events.filter((e) => e.type !== "summary-success")).toHaveLength(
        0,
      );
      expect(events.at(-1)).toEqual({ type: "summary-success" });
    });

    test("errors when an unregistered file default exports a non-module", async () => {
      // Nothing can ever load this file under this name, so it is not something
      // to skip quietly - it is a mistake.
      const events = await runOn(["content/unregistered-not-a-module.val.ts"]);

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "fatal-error",
            file: "/content/unregistered-not-a-module.val.ts",
            message: expect.stringContaining("not a Val module"),
          }),
        ]),
      );
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    });

    test("reports every file broken by the same throwing import", async () => {
      // Regression: the inspector shares one module cache across files, and the
      // loader caches a module BEFORE evaluating it so cycles resolve. A module
      // that threw therefore left a half-built entry behind, and the next file
      // to import it hit that entry, saw empty exports, and got reported as
      // "default export is undefined" - downgrading a real error to a warning,
      // in an order-dependent way.
      const events = await runOn([
        "content/unregistered-throws-a.val.ts",
        "content/unregistered-throws-b.val.ts",
      ]);

      const fatal = events.filter((e) => e.type === "fatal-error");
      expect(fatal).toEqual([
        expect.objectContaining({
          file: "/content/unregistered-throws-a.val.ts",
          message: expect.stringContaining("helper boom"),
        }),
        expect.objectContaining({
          file: "/content/unregistered-throws-b.val.ts",
          message: expect.stringContaining("helper boom"),
        }),
      ]);
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 2 });
    });
  });

  describe("jsonValues", () => {
    const runOn = async (valFiles: string[]) => {
      const events: ValidationEvent[] = [];
      for await (const event of runValidation({
        root: tmpDir,
        fix: false,
        valFiles,
        project: undefined,
        remote: mockRemote,
        fs: createDefaultValFSHost(),
      })) {
        events.push(event);
      }
      return events;
    };

    test("validates entry CONTENT, which lives outside the .val.ts", async () => {
      // Regression: `val validate` reported a jsonValues module as valid no matter
      // what its entries contained. The record-level schema only asserts the
      // marker shape — deep validation is deferred to whoever loads the entry, and
      // the CLI never did. Any project gating CI on `val validate` was blind to it.
      //
      // The violation here is a VALUE one (minLength), like the other fixtures in
      // this directory: with `resolveJsonModule` on, tsc catches type-level
      // mistakes in a hand-authored entry by itself — constraints are what only
      // validation can see.
      const events = await runOn(["content/basic-json-values.val.ts"]);
      const errors = events.filter((e) => e.type === "validation-error");

      // The path names the ENTRY, not just the module: for a record with
      // hundreds of entries, "something in here is wrong" is not a report.
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourcePath: '/content/basic-json-values.val.ts?p="/broken"."title"',
            message: expect.stringContaining("2 characters"),
          }),
        ]),
      );
      // ...and the entry that IS valid produces nothing.
      expect(
        errors.filter(
          (e) => "sourcePath" in e && e.sourcePath.includes('"/ok"'),
        ),
      ).toHaveLength(0);
    });

    test("reports an inlined entry as a fixable error", async () => {
      // The types accept an inline entry (see JsonValuesRecordSrc), so validation
      // is the thing that has to catch it — otherwise a hand-authored entry
      // quietly stays in the `.val.ts`, where the Studio cannot edit it and the
      // lazy-loading the record opted into does not apply.
      const events = await runOn(["content/basic-inline-json-values.val.ts"]);

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "validation-fixable-error",
            sourcePath: '/content/basic-inline-json-values.val.ts?p="/inline"',
            fixable: true,
            message: expect.stringContaining("written inline"),
          }),
        ]),
      );
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    });

    test("--fix moves an inlined entry into its own *.val.json", async () => {
      const events: ValidationEvent[] = [];
      for await (const event of runValidation({
        root: tmpDir,
        fix: true,
        valFiles: ["content/basic-inline-json-values.val.ts"],
        project: undefined,
        remote: mockRemote,
        fs: createDefaultValFSHost(),
      })) {
        events.push(event);
      }
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "fix-applied",
            sourcePath: '/content/basic-inline-json-values.val.ts?p="/inline"',
          }),
        ]),
      );

      // The content moved to the conventional path for the key...
      const jsonPath = path.join(
        tmpDir,
        "content/basic-inline-json-values/inline.val.json",
      );
      expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual({
        title: "Written inline",
        order: 3,
      });
      // ...and the module now references it lazily, like every other entry.
      const valTs = fs.readFileSync(
        path.join(tmpDir, "content/basic-inline-json-values.val.ts"),
        "utf8",
      );
      expect(valTs).toContain(
        'c.json(() => import("./basic-inline-json-values/inline.val.json"))',
      );
      expect(valTs).not.toContain("Written inline");

      // Re-validating the fixed project is clean: the fix is not just silencing
      // the error, it produces a module that loads and validates.
      const afterFix: ValidationEvent[] = [];
      for await (const event of runValidation({
        root: tmpDir,
        fix: false,
        valFiles: ["content/basic-inline-json-values.val.ts"],
        project: undefined,
        remote: mockRemote,
        fs: createDefaultValFSHost(),
      })) {
        afterFix.push(event);
      }
      expect(afterFix.at(-1)).toEqual({ type: "summary-success" });
    });

    test("keeps the item-schema error alongside the inline-entry error", async () => {
      // Both validations report at the SAME source path: the record-level one
      // checks the inline value against the item schema, and the jsonValues one
      // reports the inlining. Merging them with a spread drops one of the two,
      // so the author fixes the inlining and only then learns the value was
      // never valid.
      const events = await runOn([
        "content/basic-inline-json-values-invalid.val.ts",
      ]);

      const sourcePath =
        '/content/basic-inline-json-values-invalid.val.ts?p="/inline"';
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "validation-fixable-error",
            sourcePath,
            message: expect.stringContaining("written inline"),
          }),
          expect.objectContaining({
            type: "validation-error",
            sourcePath,
            message: expect.stringContaining("at least 5"),
          }),
        ]),
      );
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 2 });
    });

    test("reports a fixable error INSIDE an entry instead of throwing", async () => {
      // Regression: every image validation ends in a fix (whether the stored
      // dimensions match the bytes can only be answered by reading the file), and
      // the fix handlers resolved the reported path against the module source —
      // which for a jsonValues module holds a `c.json(...)` marker where the
      // entry content should be. `Internal.resolvePath` refuses to walk into a
      // marker, so a single `s.image()` inside an entry aborted the whole run
      // with "Cannot resolve path into a jsonValues entry until its content is
      // loaded" — no report, no exit code, nothing fixable.
      const events = await runOn(["content/basic-json-values-image.val.ts"]);

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "validation-fixable-error",
            sourcePath:
              '/content/basic-json-values-image.val.ts?p="/with-image"."image"',
            fixable: true,
          }),
        ]),
      );
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    });

    test("--fix writes the entry's metadata into its *.val.json", async () => {
      const events: ValidationEvent[] = [];
      for await (const event of runValidation({
        root: tmpDir,
        fix: true,
        valFiles: ["content/basic-json-values-image.val.ts"],
        project: undefined,
        remote: mockRemote,
        fs: createDefaultValFSHost(),
      })) {
        events.push(event);
      }
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "fix-applied",
            sourcePath:
              '/content/basic-json-values-image.val.ts?p="/with-image"."image"',
          }),
        ]),
      );

      // The metadata belongs in the entry's own file: the `.val.ts` has no place
      // to put it, and a patch applied there would either fail or corrupt the
      // `c.json(...)` reference.
      const jsonPath = path.join(
        tmpDir,
        "content/json-entries/with-image.val.json",
      );
      expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual({
        title: "An entry with an image",
        image: {
          path: "/public/val/image.png",
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
      });
      const valTs = fs.readFileSync(
        path.join(tmpDir, "content/basic-json-values-image.val.ts"),
        "utf8",
      );
      expect(valTs).toContain(
        'c.json(() => import("./json-entries/with-image.val.json"))',
      );
      expect(valTs).not.toContain("mimeType");

      // The bug the user hit was the SECOND run: fixing once and then failing
      // forever is the same as never fixing at all.
      const afterFix = await runOn(["content/basic-json-values-image.val.ts"]);
      expect(afterFix.at(-1)).toEqual({ type: "summary-success" });
    });

    test("--fix reaches into a ROUTER's entry file too", async () => {
      // The reported bug was on a router (`s.router(nextAppRouter, ...).jsonValues()`),
      // not a plain record. A router serializes as a record so it takes the same
      // path, but nothing covered it — and a router's entry keys are URL paths,
      // which is what the failing report showed: `"/jobb/student"."pageImage"`.
      const before = await runOn(["app/jobb/[slug]/page.val.ts"]);
      expect(before).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "validation-fixable-error",
            sourcePath:
              '/app/jobb/[slug]/page.val.ts?p="/jobb/student"."pageImage"',
          }),
        ]),
      );

      const events: ValidationEvent[] = [];
      for await (const event of runValidation({
        root: tmpDir,
        fix: true,
        valFiles: ["app/jobb/[slug]/page.val.ts"],
        project: undefined,
        remote: mockRemote,
        fs: createDefaultValFSHost(),
      })) {
        events.push(event);
      }
      expect(events.at(-1)).toEqual({ type: "summary-success" });

      const jsonPath = path.join(
        tmpDir,
        "app/jobb/[slug]/page/jobb/student.val.json",
      );
      expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual({
        header: "Student",
        pageImage: {
          path: "/public/val/image.png",
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
      });
      expect((await runOn(["app/jobb/[slug]/page.val.ts"])).at(-1)).toEqual({
        type: "summary-success",
      });
    });

    test("rejects a nested .jsonValues() instead of reporting it valid", async () => {
      // Root-only is a hard contract: a nested one would silently get NO content
      // validation. The Studio refuses to load such a project, so the CLI saying
      // "valid" was the two entry points disagreeing.
      const events = await runOn(["content/basic-nested-json-values.val.ts"]);

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "fatal-error",
            message: expect.stringContaining(
              "Nested .jsonValues() records are not supported",
            ),
          }),
        ]),
      );
      expect(events.at(-1)).not.toEqual({ type: "summary-success" });
    });
  });
});
