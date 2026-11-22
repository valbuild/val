import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SourceError } from "../acquireTypes";
import { installedSources } from "./installedSources";
import { typecheckInstalled } from "./typecheckInstalled";

/*
 * A project installed on this machine, made by hand: the layouts an install
 * leaves (pnpm's virtual store, a hoisted node_modules, links into a store
 * shared by every project), and a typecheck of a project whose only
 * dependency is the TypeScript this repository has installed.
 */
const REPO = path.resolve(__dirname, "../../../../..");
const TYPESCRIPT = fs.realpathSync(
  path.join(
    REPO,
    "node_modules/.pnpm/typescript@6.0.3/node_modules/typescript",
  ),
);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-installed-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, text: string) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function writePackage(at: string, name: string, version: string) {
  write(`${at}/package.json`, JSON.stringify({ name, version }));
  write(`${at}/index.d.ts`, `export declare const name: "${name}";`);
  write(`${at}/index.js`, `export const name = "${name}";`);
  write(`${at}/node_modules/nested/index.d.ts`, "not this package's");
}

function link(target: string, at: string) {
  const full = path.join(dir, at);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.symlinkSync(target, full, "dir");
}

describe("installedSources", () => {
  test("a package in pnpm's virtual store, by what its manifest says", async () => {
    // pnpm shortens a long slot name to a hash: the name says nothing.
    writePackage(
      "node_modules/.pnpm/8c1f0e2a9b/node_modules/@scope/long-name",
      "@scope/long-name",
      "1.2.3",
    );
    const bundle = await installedSources(dir).types({
      name: "@scope/long-name",
      version: "1.2.3",
      integrity: null,
    });
    expect(bundle).toEqual({
      files: {
        "package.json": JSON.stringify({
          name: "@scope/long-name",
          version: "1.2.3",
        }),
        "index.d.ts": 'export declare const name: "@scope/long-name";',
      },
      stubs: ["index.js"],
    });
  });

  test("a hoisted install, with no virtual store", async () => {
    writePackage("node_modules/hoisted", "hoisted", "2.0.0");
    const bundle = await installedSources(dir).types({
      name: "hoisted",
      version: "2.0.0",
      integrity: null,
    });
    expect(Object.keys(bundle.files).sort()).toEqual([
      "index.d.ts",
      "package.json",
    ]);
  });

  test("a slot linked into a store outside the project", async () => {
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), "val-store-"));
    try {
      fs.mkdirSync(path.join(shared, "linked"));
      fs.writeFileSync(
        path.join(shared, "linked/package.json"),
        JSON.stringify({ name: "linked", version: "3.0.0" }),
      );
      link(
        path.join(shared, "linked"),
        "node_modules/.pnpm/linked@3.0.0/node_modules/linked",
      );
      const bundle = await installedSources(dir).types({
        name: "linked",
        version: "3.0.0",
        integrity: null,
      });
      expect(Object.keys(bundle.files)).toEqual(["package.json"]);
    } finally {
      fs.rmSync(shared, { recursive: true, force: true });
    }
  });

  test("another version than the one asked for is not installed", async () => {
    writePackage("node_modules/.pnpm/a@1.0.0/node_modules/a", "a", "1.0.0");
    const asked = installedSources(dir).types({
      name: "a",
      version: "1.0.1",
      integrity: null,
    });
    await expect(asked).rejects.toBeInstanceOf(SourceError);
    await expect(asked).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("typecheckInstalled", () => {
  const lockfile = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      typescript:
        specifier: 6.0.3
        version: 6.0.3

packages:

  typescript@6.0.3:
    resolution: {integrity: sha512-0000}
    engines: {node: '>=14.17'}
    hasBin: true

snapshots:

  typescript@6.0.3: {}
`;
  const tsconfig = JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022"],
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      types: [],
    },
    include: ["src"],
  });

  test("checks the files it is given, with the TypeScript installed here", async () => {
    write("pnpm-lock.yaml", lockfile);
    link(
      TYPESCRIPT,
      "node_modules/.pnpm/typescript@6.0.3/node_modules/typescript",
    );
    link(
      path.join(
        dir,
        "node_modules/.pnpm/typescript@6.0.3/node_modules/typescript",
      ),
      "node_modules/typescript",
    );
    // On disk it is fine: what is checked is what is handed over.
    write("src/index.ts", "export const n: number = 1;\n");
    const outcome = await typecheckInstalled({
      root: dir,
      files: {
        "tsconfig.json": tsconfig,
        "src/index.ts": 'export const n: number = "one";\n',
      },
    });
    if (outcome.status !== "checked") {
      throw new Error(`Not checked: ${JSON.stringify(outcome)}`);
    }
    expect(outcome.result.typescript.version).toBe("6.0.3");
    expect(outcome.result.missing).toEqual([]);
    expect(
      outcome.result.errors.map(({ file, line, code }) => ({
        file,
        line,
        code,
      })),
    ).toEqual([{ file: "src/index.ts", line: 1, code: 2322 }]);
  });

  test("a project without a pnpm lockfile is skipped, saying why", async () => {
    write("package-lock.json", "{}");
    const outcome = await typecheckInstalled({
      root: dir,
      files: { "tsconfig.json": tsconfig },
    });
    expect(outcome.status).toBe("skipped");
  });

  test("a TypeScript that is not installed fails the check, not the caller", async () => {
    write("pnpm-lock.yaml", lockfile);
    const outcome = await typecheckInstalled({
      root: dir,
      files: { "tsconfig.json": tsconfig, "src/index.ts": "export {};\n" },
    });
    expect(outcome).toEqual({
      status: "failed",
      message: "typescript@6.0.3 is not installed here.",
    });
  });
});
