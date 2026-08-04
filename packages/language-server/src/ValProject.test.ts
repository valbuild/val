import fs from "fs";
import os from "os";
import path from "path";
import type { ModuleFilePath } from "@valbuild/core";
import { mapOpenDocuments } from "./EditorFsHost";
import { createValProject } from "./ValProject";

/**
 * The integration tests here evaluate real Val modules through QuickJS, which
 * costs ~100ms of runtime boot plus ~15ms per module.
 */
jest.setTimeout(60000);

const EXAMPLE_APP = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "examples",
  "next",
);

describe("createValProject — initialisation failures", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-project-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("reports missing-core rather than failing per module", async () => {
    // Easy to hit under pnpm: a project that declares only @valbuild/next has no
    // resolvable @valbuild/core, and every module would otherwise fail with a
    // fatal "Could not resolve module: '@valbuild/core'".
    //
    // The resolver is injected because jest's module registry intercepts
    // createRequire and resolves against this repo whatever base path it is
    // given, so the real resolver always reports success under test.
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    const project = createValProject({
      valRoot: dir,
      open: mapOpenDocuments(),
      isCoreResolvable: () => false,
    });

    const result = await project.getModule("/x.val.ts" as ModuleFilePath);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("missing-core");
      expect(result.error.message).toMatch(/direct dependency/);
    }
    await project.dispose();
  });

  test("does not throw when the Val root has no tsconfig", async () => {
    // getCompilerOptions throws in this case; a misconfigured project must
    // degrade to "no diagnostics", not take the server down.
    const project = createValProject({
      valRoot: path.join(dir, "nonexistent"),
      open: mapOpenDocuments(),
    });
    const result = await project.getModule("/x.val.ts" as ModuleFilePath);
    expect(result.status).toBe("error");
    await project.dispose();
  });
});

describe("createValProject — evaluating the example app", () => {
  const modulePath = "/content/authors.val.ts" as ModuleFilePath;
  let project: ReturnType<typeof createValProject>;
  let open: ReturnType<typeof mapOpenDocuments>;

  beforeEach(() => {
    open = mapOpenDocuments();
    project = createValProject({ valRoot: EXAMPLE_APP, open });
  });

  afterEach(async () => {
    await project.dispose();
  });

  test("returns schema and source for a valid module", async () => {
    const result = await project.getModule(modulePath);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.cached).toBe(false);
    expect(result.content.schema).toBeDefined();
    expect(result.content.source).toBeDefined();
    expect(result.content.errors).toBe(false);
  });

  test("serves a repeated request from cache", async () => {
    await project.getModule(modulePath);
    const second = await project.getModule(modulePath);
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.cached).toBe(true);
    expect(project.cacheSize()).toBe(1);
  });

  test("invalidate() forces re-evaluation", async () => {
    await project.getModule(modulePath);
    project.invalidate(modulePath);
    expect(project.cacheSize()).toBe(0);
    const again = await project.getModule(modulePath);
    expect(again.status === "ok" && again.cached).toBe(false);
  });

  test("evaluates the editor's unsaved buffer, not the file on disk", async () => {
    // The load-bearing behaviour of the whole phase: an edit that has not been
    // saved must still be what gets validated.
    const absolute = path.join(EXAMPLE_APP, modulePath);
    const onDisk = fs.readFileSync(absolute, "utf8");

    const clean = await project.getModule(modulePath);
    expect(clean.status === "ok" && clean.content.errors).toBe(false);

    // readValFile logs fatal module errors to console.error, and we are about to
    // cause one on purpose. Silence it so the expected failure is not mistaken
    // for a broken test.
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Break the module in the editor only -- disk is untouched.
    open.set(absolute, onDisk.replace("c.define(", "c.defineBROKEN("));
    const dirty = await project.getModule(modulePath);
    consoleError.mockRestore();

    expect(dirty.status).toBe("ok");
    if (dirty.status !== "ok") return;
    expect(dirty.cached).toBe(false);
    expect(dirty.content.errors).not.toBe(false);

    // Disk really was untouched, so reverting the buffer restores validity.
    expect(fs.readFileSync(absolute, "utf8")).toBe(onDisk);
    open.set(absolute, onDisk);
    const reverted = await project.getModule(modulePath);
    expect(reverted.status === "ok" && reverted.content.errors).toBe(false);
  });

  test("surfaces validation errors for a module that has them", async () => {
    const result = await project.getModule(
      "/content/media.val.ts" as ModuleFilePath,
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // Known bad image metadata in the example app.
    expect(result.content.errors).not.toBe(false);
  });
});
