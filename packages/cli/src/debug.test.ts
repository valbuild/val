import fs from "fs";
import os from "os";
import path from "path";
import { ModuleFilePath } from "@valbuild/core";
import { readPatchStore } from "@valbuild/server";
import { createDebugContext } from "./debug/context";
import { buildSnapshot } from "./debug/snapshot";

const FIXTURE = path.resolve(__dirname, "__fixtures__/debug-snapshot");

/**
 * The fixture is a project whose patch chain reproduces the blankno incident: a
 * patch removes `services[2]`, and a later patch from another editor tries to
 * replace it.
 */
describe("val debug snapshot", () => {
  const build = async () => {
    const ctx = await createDebugContext({ root: FIXTURE });
    return buildSnapshot(ctx);
  };

  test("reports the unappliable patch, attributed to its author", async () => {
    const { manifest, report } = await build();

    expect(manifest.mode).toBe("fs");
    expect(manifest.patchCount).toBe(3);
    expect(manifest.unappliablePatchCount).toBe(1);
    const [patchId, failure] = Object.entries(report.unappliablePatches)[0];
    expect(patchId).toBe("33333333-3333-4333-8333-333333333333");
    expect(failure.message).toBe("Array index out of bounds");
    expect(failure.moduleFilePath).toBe("/content/projects.val.ts");
  });

  test("does not report spurious validation errors for cross-module references", async () => {
    // keyOf resolves against another module's source, so validating with only
    // the patched modules' sources reports the referenced module as missing.
    const { report } = await build();

    expect(report.validationErrors).toEqual({});
  });

  test("carries the patched module, what it references, and nothing else", async () => {
    const { manifest, entries } = await build();

    const included = manifest.modules.map((m) => m.moduleFilePath).sort();
    expect(included).toEqual([
      "/content/projects.val.ts",
      "/content/tags.val.ts",
    ]);
    expect(
      manifest.modules.find(
        (m) => m.moduleFilePath === ("/content/tags.val.ts" as ModuleFilePath),
      )?.reasons,
    ).toEqual([{ type: "keyOf", from: "/content/projects.val.ts" }]);

    // The shared schema fragment is reached through the import graph: without it
    // loadValModules cannot evaluate the snapshot.
    expect(entries["content/summary.ts"]).toContain("summarySchema");
    expect(entries["val.config.ts"]).toBeDefined();
    // getCompilerOptions() throws without this.
    expect(entries["tsconfig.json"]).toBeDefined();

    expect(entries["content/unrelated.val.ts"]).toBeUndefined();
  });

  test("generates a val.modules.ts limited to the carried modules", async () => {
    const { entries } = await build();

    const generated = entries["val.modules.ts"];
    expect(generated).toContain('import("./content/projects.val")');
    expect(generated).toContain('import("./content/tags.val")');
    expect(generated).not.toContain("unrelated");
    // The project's own version is kept for reference.
    expect(entries["val.modules.original.ts"]).toContain("unrelated");
  });

  test("writes a patch store ValOpsFS can actually read back", async () => {
    const { entries } = await build();

    // Materialise it and read it with the real store, rather than asserting on
    // path strings: "the layout ValOpsFS reads back" is the property, and a
    // snapshot that merely looks right is exactly what a debug tool must not
    // produce.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-snapshot-"));
    for (const [name, content] of Object.entries(entries)) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }

    const read = readPatchStore(path.join(dir, ".val", "patches"));
    if (read.status !== "ok") {
      throw new Error(`expected ok, got ${read.status}`);
    }
    expect(read.problems).toEqual([]);
    expect(read.entries.map((entry) => entry.patchId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);

    // Each record sits under its own id and points at nothing. A record that
    // named its parent is how a snapshot could carry a chain that had already
    // lost a link.
    for (const entry of read.entries) {
      const raw = JSON.parse(
        entries[`.val/patches/${entry.patchId}/patch.json`],
      );
      expect(raw.patchId).toBe(entry.patchId);
      expect(raw).not.toHaveProperty("parentRef");
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("records why the snapshot may be incomplete rather than failing silently", async () => {
    const { manifest } = await build();

    // Bare package specifiers are expected and harmless; the point is that they
    // are listed, so a tsconfig path alias (which would break the replay) is
    // visible too.
    expect(manifest.unresolvedImports).toEqual([
      { from: "/val.config.ts", specifier: "@valbuild/core" },
    ]);
    expect(manifest.elidedPatchValues).toEqual([]);
    expect(manifest.includesBinaryFiles).toBe(false);
  });
});
