import * as fs from "node:fs";
import * as path from "node:path";
import { parsePnpmLockfile } from "../pnpmLockfile";
import { readInstalledLayout } from "./readInstalledLayout";

/**
 * Makes a fixture for `pnpmLayout.test.ts` from a project that a real
 * `pnpm install` has just run in:
 *
 *     pnpm exec tsx packages/ui/spa/typecheck/testing/makeLayoutFixture.ts \
 *       <installed project> <fixture name>
 *
 * It copies the lockfile and `pnpm-workspace.yaml`, records each importer's
 * package name (the lockfile does not have them, and the hoist needs them),
 * and writes what is on disk in `node_modules` to `installed.json`. Say in
 * `pnpmLayout.test.ts` which pnpm made it, and from what.
 */
const [projectArg, name] = process.argv.slice(2);
if (!projectArg || !name) {
  console.error(
    "Usage: makeLayoutFixture.ts <installed project> <fixture name>",
  );
  process.exit(1);
}
const project = path.resolve(projectArg);
const out = path.join(import.meta.dirname, "..", "fixtures", name);
fs.mkdirSync(out, { recursive: true });

const lockfileText = fs.readFileSync(
  path.join(project, "pnpm-lock.yaml"),
  "utf8",
);
fs.writeFileSync(path.join(out, "pnpm-lock.yaml"), lockfileText);
const workspace = path.join(project, "pnpm-workspace.yaml");
if (fs.existsSync(workspace)) {
  fs.copyFileSync(workspace, path.join(out, "pnpm-workspace.yaml"));
}
const importers = Object.keys(parsePnpmLockfile(lockfileText).importers);
const workspaceNames: Record<string, string> = {};
for (const id of importers) {
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(project, id, "package.json"), "utf8"),
  );
  if (
    typeof manifest === "object" &&
    manifest !== null &&
    "name" in manifest &&
    typeof manifest.name === "string"
  ) {
    workspaceNames[id] = manifest.name;
  }
}
const installed = readInstalledLayout(project, importers);
fs.writeFileSync(
  path.join(out, "installed.json"),
  `${JSON.stringify({ workspaceNames, ...installed }, null, 2)}\n`,
);
console.log(
  `${name}: ${Object.keys(installed.links).length} links, ${installed.packages.length} packages`,
);
