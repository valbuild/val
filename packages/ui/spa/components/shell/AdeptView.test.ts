import { lockedPackages, typescriptVersion } from "./AdeptView";

const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      react:
        specifier: ^19.0.0
        version: 19.1.0
    devDependencies:
      typescript:
        specifier: ^5.9.0
        version: 5.9.3

  packages/a:
    devDependencies:
      typescript:
        specifier: ^6.0.0
        version: 6.0.3

packages:

  '@types/node@22.10.0':
    resolution: {integrity: sha512-abc==}

  react@19.1.0:
    resolution: {integrity: sha512-def==}
    engines: {node: '>=0.10.0'}

  b@link:../b:
    resolution: {directory: ../b, type: directory}

snapshots:

  react@19.1.0: {}
`;

test("the registry packages of the lockfile, with their integrity", () => {
  expect(lockedPackages(LOCKFILE)).toEqual([
    { name: "@types/node", version: "22.10.0", integrity: "sha512-abc==" },
    { name: "react", version: "19.1.0", integrity: "sha512-def==" },
  ]);
});

test("the root importer's TypeScript, not a workspace project's", () => {
  expect(typescriptVersion(LOCKFILE)).toBe("5.9.3");
  expect(typescriptVersion("lockfileVersion: '9.0'\n")).toBeNull();
});
