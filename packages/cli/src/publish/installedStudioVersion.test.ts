import fs from "fs";
import os from "os";
import path from "path";
import { installedStudioVersion } from "./buildArtifacts";

/**
 * The `@valbuild/ui` a checkout runs is the one its `@valbuild/tanstack`
 * resolves. pnpm does not hoist a transitive dependency, so it sits beside
 * tanstack rather than at the project's root -- and a root copy, where there
 * is one, is not necessarily the Studio that runs.
 */

let root: string;

function writePackage(dir: string, name: string, version: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version }),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-version-"));
  writePackage(root, "a-site", "0.0.0");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("is the @valbuild/ui that @valbuild/tanstack resolves", () => {
  const tanstack = path.join(root, "node_modules", "@valbuild", "tanstack");
  writePackage(tanstack, "@valbuild/tanstack", "0.149.1");
  writePackage(
    path.join(tanstack, "node_modules", "@valbuild", "ui"),
    "@valbuild/ui",
    "0.149.1",
  );
  writePackage(
    path.join(root, "node_modules", "@valbuild", "ui"),
    "@valbuild/ui",
    "0.148.7",
  );
  expect(installedStudioVersion(root)).toBe("0.149.1");
});

test("is the project's own @valbuild/ui without @valbuild/tanstack", () => {
  writePackage(
    path.join(root, "node_modules", "@valbuild", "ui"),
    "@valbuild/ui",
    "0.149.1",
  );
  expect(installedStudioVersion(root)).toBe("0.149.1");
});

test("is null when nothing is installed", () => {
  expect(installedStudioVersion(root)).toBeNull();
});
