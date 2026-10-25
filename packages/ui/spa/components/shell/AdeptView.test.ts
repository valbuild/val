import { StudioPublishError } from "../../publish/publishClient";
import { SourceError } from "@valbuild/shared/typecheck";
import {
  Abandoned,
  failureOf,
  lockedPackages,
  runJob,
  setVersionsOf,
  typescriptVersion,
} from "./AdeptView";

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

describe("what a failure lets the person do", () => {
  test("signed out is Sign in, not a status code", () => {
    expect(
      failureOf(new StudioPublishError(401, "Unauthorized", null)),
    ).toEqual({
      kind: "signed-out",
    });
  });

  test("a deployment with no content service to ask is not offered Try again", () => {
    const failure = failureOf(new StudioPublishError(501, "Not here", null));
    expect(failure.kind === "error" && failure.retryable).toBe(false);
  });

  test("a gateway that did not answer is", () => {
    const failure = failureOf(new StudioPublishError(502, "Bad gateway", null));
    expect(failure.kind === "error" && failure.retryable).toBe(true);
  });

  test("adept's own answer says whether to try again", () => {
    const failure = failureOf(
      new StudioPublishError(422, "x", {
        error: {
          code: "does-not-resolve",
          message: "no zod@99",
          retryable: false,
        },
      }),
    );
    expect(failure).toEqual({
      kind: "error",
      code: "does-not-resolve",
      message: "no zod@99",
      retryable: false,
    });
  });

  test("a typecheck signed out is Sign in too", () => {
    expect(failureOf(new SourceError("Sign in.", "401", false, 401))).toEqual({
      kind: "signed-out",
    });
  });

  test("a typecheck's failure keeps adept's code and whether to try again", () => {
    expect(
      failureOf(new SourceError("adept is busy", "busy", true, 429)),
    ).toEqual({
      kind: "error",
      code: "busy",
      message: "adept is busy",
      retryable: true,
    });
  });

  test("versions that are not JSON are the field's to fix", () => {
    let thrown: unknown;
    try {
      setVersionsOf("{ react: 19 }");
    } catch (error) {
      thrown = error;
    }
    expect(failureOf(thrown)).toEqual({
      kind: "input",
      message: expect.stringContaining('{ "name": "1.2.3" }'),
    });
  });

  test("so is JSON that does not name exact versions", () => {
    expect(() => setVersionsOf('{ "react": 19 }')).toThrow(/exact version/);
    expect(() => setVersionsOf("{}")).toThrow(/exact version/);
    expect(setVersionsOf('{ "react": "19.1.0" }')).toEqual({ react: "19.1.0" });
  });
});

describe("a job is polled until it ends, and no longer", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  function answering(states: string[]) {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      const state = states.shift() ?? "running";
      return new Response(JSON.stringify({ id: 7, state }), { status: 200 });
    });
    return calls;
  }

  test("a state it does not know is not waited out", async () => {
    jest.useFakeTimers();
    answering(["queued", "expired"]);
    const job = runJob(
      "/adept/lockfile",
      {},
      () => {},
      new AbortController().signal,
    );
    const settled = expect(job).rejects.toThrow(/'expired'/);
    await jest.advanceTimersByTimeAsync(1000);
    await settled;
  });

  test("leaving stops the polling", async () => {
    jest.useFakeTimers();
    const calls = answering(["queued"]);
    const controller = new AbortController();
    const job = runJob("/adept/lockfile", {}, () => {}, controller.signal);
    const settled = expect(job).rejects.toBeInstanceOf(Abandoned);
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await settled;
    const before = calls.length;
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.length).toBe(before);
  });
});
