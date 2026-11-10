import { execFileSync } from "child_process";
import path from "path";

/**
 * A hosted project's variables are read at RUNTIME, not built in.
 *
 * They are set in Val Build, and a build is made in an editor's browser tab: a
 * value built in would sit in that tab, and a value changed in Val Build would
 * wait for somebody to build before it went live. So `import.meta.env` reads
 * them from the page in the browser (the loader writes a `<head>` script) and
 * from `process.env` on the server (the isolate's env), and Vite's built-ins
 * are still inlined. See `envFor` in build.ts.
 *
 * The probe runs both bundles; see the comment at its top for why.
 */

type Read = Record<string, unknown>;
type Probe = {
  client: Read;
  server: Read;
  identifierLeft: boolean;
  clientHasServerOnly: boolean;
  unreadInlinedAnywhere: boolean;
};

let probe: Probe;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "runtimeEnvProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // tsx's WASI warnings share stdout's stream in some shells; take the last
  // line that parses rather than assuming the output is only JSON.
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as Probe;
}, 300_000);

test("every read was given something to read", () => {
  // An identifier left behind is a ReferenceError on the first render.
  expect(probe.identifierLeft).toBe(false);
});

describe.each(["client", "server"] as const)("the %s bundle", (side) => {
  const read = () => probe[side];

  test("reads a PUBLIC_ variable at runtime, however it is spelled", () => {
    expect(read().direct).toBe("direct");
    expect(read().destructured).toBe("destructured");
    expect(read().node).toBe("node");
  });

  test("reads it at the top level of a module too", () => {
    expect(read().atTop).toBe("top");
  });

  test("still inlines Vite's built-ins", () => {
    expect(read().mode).toBe("production");
    expect(read().ssr).toBe(side === "server");
  });

  test("lets a value inlined at build time win", () => {
    expect(read().inlined).toBe("from-build");
  });

  test("reads no other name through import.meta.env, as in Vite", () => {
    expect(read().notPublic).toBeUndefined();
  });
});

test("the server reads any name through process.env", () => {
  expect(probe.server.notPublicNode).toBe("server-only");
});

test("the browser reads no other name through process.env, and does not throw", () => {
  expect(probe.client.notPublicNode).toBeUndefined();
});

test("a value that is not PUBLIC_ never reaches the browser bundle", () => {
  expect(probe.clientHasServerOnly).toBe(false);
});

test("a build-time value nothing reads is in neither bundle", () => {
  // The import.meta.env object holds PUBLIC_ names only: a server-only one in
  // it would be in the server bundle whether anything read it or not.
  expect(probe.unreadInlinedAnywhere).toBe(false);
});
