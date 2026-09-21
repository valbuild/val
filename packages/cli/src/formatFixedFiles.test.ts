import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import path from "path";
import fs from "fs";
import synchronizedPrettier from "@prettier/sync";
import { DEFAULT_VAL_REMOTE_HOST } from "@valbuild/core";
import {
  createDefaultValFSHost,
  runValidation,
  IValRemote,
} from "./runValidation";
import { formatFixedFiles } from "./formatFixedFiles";

/**
 * The step `val validate --fix` ends on, against a real project on disk.
 *
 * The fixes here are produced by `runValidation` itself rather than written by
 * the test, because the thing being checked is what happens to the TypeScript
 * the fix pipeline emits — which is unformatted, and which used to be handed to
 * `prettier.format(code, { filepath })` and therefore rewritten in prettier's
 * defaults no matter what the project had configured.
 *
 * It stops short of calling `validate()` because that ends in `process.exit`
 * once the fixture's remaining errors are counted, which would take the jest
 * worker with it. `validate()` does nothing between the two but render.
 *
 * `@prettier/sync` rather than `prettier`: prettier 3's CommonJS entry loads its
 * ESM build with a dynamic `import()`, which jest refuses without
 * `--experimental-vm-modules`.
 */

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");

// The fixture is copied INSIDE the package rather than into the OS temp dir:
// the project's `val.config.ts` is evaluated with a `require` resolving from
// its own path, so it has to be somewhere `@valbuild/core` can be walked up to.
const TMP_BASE = path.join(__dirname, ".tmp");

/** A module in neither style, so either pass has something to change. */
const UNFORMATTED_MODULE = `import {c,s} from "../val.config"
export default c.define("/content/basic-image.val.ts",s.image(),{path:"/public/val/image.png"})
`;

const mockRemote: IValRemote = {
  remoteHost: DEFAULT_VAL_REMOTE_HOST,
  getSettings: async () => {
    throw new Error("Not expected to be called");
  },
  uploadFile: async () => {
    throw new Error("Not expected to be called");
  },
};

/** Apply every fix in `valFiles`, and report which files were written. */
async function applyFixes(
  tmpDir: string,
  valFiles: string[],
): Promise<string[]> {
  const fixed = new Set<string>();
  for await (const event of runValidation({
    root: tmpDir,
    fix: true,
    valFiles,
    project: undefined,
    remote: mockRemote,
    fs: createDefaultValFSHost(),
  })) {
    if (event.type === "fix-applied") {
      fixed.add(event.file);
    }
  }
  return [...fixed];
}

describe("formatFixedFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    fs.mkdirSync(TMP_BASE, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(TMP_BASE, "formatFixedFiles-"));
    fs.cpSync(BASIC_FIXTURE, tmpDir, { recursive: true });
    // Every case writes its own config into its own directory, and prettier
    // caches per directory for the life of the process — including the fact
    // that a directory had none.
    synchronizedPrettier.clearConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(config: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(tmpDir, ".prettierrc.json"),
      JSON.stringify(config),
    );
  }

  test("formats a fixed file with the project's config, not prettier's defaults", async () => {
    writeConfig({ singleQuote: true, semi: false });
    const fixed = await applyFixes(tmpDir, ["content/basic-image.val.ts"]);
    expect(fixed).toEqual(["content/basic-image.val.ts"]);

    const { written, failures } = await formatFixedFiles(
      synchronizedPrettier,
      tmpDir,
      fixed,
    );

    expect(failures).toEqual([]);
    expect(written).toEqual(["content/basic-image.val.ts"]);
    const after = fs.readFileSync(
      path.join(tmpDir, "content/basic-image.val.ts"),
      "utf-8",
    );
    // The fix landed...
    expect(after).toContain("width: 1");
    // ...in the project's style. Prettier's default is double quotes and semis,
    // which is what the old `prettier.format(code, { filepath })` produced.
    expect(after).toContain("'/public/val/image.png'");
    expect(after).not.toContain('"/public/val/image.png"');
    expect(after.trimEnd().endsWith(")")).toBe(true);
  });

  test("leaves a fixed file the project put in .prettierignore unformatted", async () => {
    writeConfig({ singleQuote: true });
    fs.writeFileSync(
      path.join(tmpDir, ".prettierignore"),
      "content/basic-image.val.ts\n",
    );
    const fixed = await applyFixes(tmpDir, ["content/basic-image.val.ts"]);

    const { written, failures } = await formatFixedFiles(
      synchronizedPrettier,
      tmpDir,
      fixed,
    );

    expect(failures).toEqual([]);
    // Nothing rewritten, so the mtime is not bumped either.
    expect(written).toEqual([]);
    const after = fs.readFileSync(
      path.join(tmpDir, "content/basic-image.val.ts"),
      "utf-8",
    );
    // The fix still landed — only the formatting was skipped.
    expect(after).toContain("width: 1");
    expect(after).toContain('"/public/val/image.png"');
  });

  test("does not rewrite a file that is already formatted", async () => {
    writeConfig({});
    const fixed = await applyFixes(tmpDir, ["content/basic-image.val.ts"]);
    const target = path.join(tmpDir, "content/basic-image.val.ts");

    // First pass formats it; a second pass has nothing left to do.
    await formatFixedFiles(synchronizedPrettier, tmpDir, fixed);
    const { written, failures } = await formatFixedFiles(
      synchronizedPrettier,
      tmpDir,
      fixed,
    );

    expect(failures).toEqual([]);
    expect(written).toEqual([]);
    expect(fs.readFileSync(target, "utf-8")).toContain("width: 1");
  });

  test("reports a file it cannot format instead of throwing, and keeps going", async () => {
    writeConfig({});
    const fixed = await applyFixes(tmpDir, ["content/basic-image.val.ts"]);
    // A parser prettier does not have: the same shape as a malformed config or
    // a plugin that fails to load, and the only failure mode reachable here
    // without breaking the file the fix just wrote.
    const brokenPrettier = {
      ...synchronizedPrettier,
      format: () => {
        throw new Error("No parser could be inferred");
      },
    };

    const { written, failures } = await formatFixedFiles(
      brokenPrettier,
      tmpDir,
      [...fixed, ...fixed],
    );

    expect(written).toEqual([]);
    // Both entries reported: the loop continued past the first failure.
    expect(failures).toHaveLength(2);
    expect(failures[0]).toEqual({
      file: "content/basic-image.val.ts",
      message: "No parser could be inferred",
    });
    // The fix is still on disk, unformatted rather than lost.
    expect(
      fs.readFileSync(path.join(tmpDir, "content/basic-image.val.ts"), "utf-8"),
    ).toContain("width: 1");
  });

  test("resolves a project-relative path against the project, with or without a leading slash", async () => {
    writeConfig({ singleQuote: true });
    const fixed = await applyFixes(tmpDir, ["content/basic-image.val.ts"]);
    // `runValidation` reports this one without a leading slash, but a
    // `ModuleFilePath` carries one and `validate.ts` strips it for display, so
    // both shapes reach here. Resolving either against the filesystem root
    // rather than the project would find a different `.prettierrc` — or none,
    // which is the old bug wearing a different hat.
    expect(fixed).toEqual(["content/basic-image.val.ts"]);
    const target = path.join(tmpDir, "content/basic-image.val.ts");

    for (const reported of [
      "content/basic-image.val.ts",
      "/content/basic-image.val.ts",
    ]) {
      fs.writeFileSync(target, UNFORMATTED_MODULE);
      const { written, failures } = await formatFixedFiles(
        synchronizedPrettier,
        tmpDir,
        [reported],
      );

      expect(failures).toEqual([]);
      expect(written).toEqual([reported]);
      expect(fs.readFileSync(target, "utf-8")).toContain(
        "'/public/val/image.png'",
      );
    }
  });
});
