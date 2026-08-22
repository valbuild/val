import fs from "fs";
import os from "os";
import path from "path";
import type { ModuleFilePath } from "@valbuild/core";
import { mapOpenDocuments } from "./EditorFsHost";
import { createValProject } from "./ValProject";

/**
 * The integration tests here evaluate the example app's real Val modules, which
 * costs a few hundred milliseconds per evaluation of the project.
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
    expect(again.status).toBe("ok");
    if (again.status !== "ok") return;
    expect(again.cached).toBe(false);
  });

  test("evaluates the editor's unsaved buffer, not the file on disk", async () => {
    // The load-bearing behaviour of the whole phase: an edit that has not been
    // saved must still be what gets validated.
    const absolute = path.join(EXAMPLE_APP, modulePath);
    const onDisk = fs.readFileSync(absolute, "utf8");

    const clean = await project.getModule(modulePath);
    expect(clean.status).toBe("ok");
    if (clean.status !== "ok") return;
    expect(clean.content.errors).toBe(false);

    // Introduce a real validation error in the editor only -- disk is untouched.
    // `name` is a string with minLength(2), so a number must be rejected.
    const broken = onDisk.replace('name: "Theodor René Carlsen"', "name: 1");
    expect(broken).not.toBe(onDisk);
    open.set(absolute, broken);
    const dirty = await project.getModule(modulePath);

    expect(dirty.status).toBe("ok");
    if (dirty.status !== "ok") return;
    expect(dirty.cached).toBe(false);
    expect(dirty.content.errors).not.toBe(false);

    // Disk really was untouched, so reverting the buffer restores validity.
    expect(fs.readFileSync(absolute, "utf8")).toBe(onDisk);
    open.set(absolute, onDisk);
    const reverted = await project.getModule(modulePath);
    expect(reverted.status).toBe("ok");
    if (reverted.status !== "ok") return;
    expect(reverted.content.errors).toBe(false);
  });

  test("reports a buffer that cannot be evaluated as a fatal module error", async () => {
    // A module that throws while being evaluated used to take the whole
    // `val.modules` evaluation down with it, so this surfaced as a project-level
    // `service-failed`. `extractValModules` now catches a rejecting `def()` and
    // records it as a module error, so the project still starts and the failure
    // arrives as a fatal error on the module itself - which is what the editor
    // can actually put a diagnostic on. The next good buffer must still recover.
    const absolute = path.join(EXAMPLE_APP, modulePath);
    const onDisk = fs.readFileSync(absolute, "utf8");

    open.set(absolute, onDisk.replace("c.define(", "c.defineBROKEN("));
    const dirty = await project.getModule(modulePath);
    expect(dirty.status).toBe("ok");
    if (dirty.status !== "ok") return;
    const errors = dirty.content.errors;
    expect(errors).not.toBe(false);
    if (errors === false) return;
    expect(errors.invalidModulePath).toBe(modulePath);
    // The load failure has to be in there: a module whose `def()` threw is
    // recorded without a path, so "was not found in val.modules" on its own
    // would point at a registration that is present and fine.
    const messages = (errors.fatal ?? []).map((e) => e.message).join("\n");
    expect(messages).toContain("could not be loaded");
    expect(messages).toContain("defineBROKEN");

    open.set(absolute, onDisk);
    const reverted = await project.getModule(modulePath);
    expect(reverted.status).toBe("ok");
    if (reverted.status !== "ok") return;
    expect(reverted.content.errors).toBe(false);
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
