import { runProbe } from "./__fixtures__/runProbe";

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
  probe = runProbe<Probe>("runtimeEnvProbe.ts");
}, 300_000);

test("every read was given something to read", () => {
  // An identifier left behind is a ReferenceError on the first render.
  expect(probe.identifierLeft).toBe(false);
});

const sides: Array<"client" | "server"> = ["client", "server"];

describe.each(sides)("the %s bundle", (side) => {
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

  test("lets a value set at runtime win over one given at build time", () => {
    // Changing a variable in Val Build changes what the site reads, even
    // where the build was also given it.
    expect(read().inlined).toBe("from-runtime");
    expect(read().inlinedNode).toBe("from-runtime");
  });

  test("falls back to a value given at build time that is not set at runtime", () => {
    expect(read().buildOnly).toBe("build-only");
    expect(read().buildOnlyNode).toBe("build-only");
  });

  test("reads no other name through import.meta.env, as in Vite", () => {
    expect(read().notPublic).toBeUndefined();
  });
});

test("a name given at build time that is not PUBLIC_ is the server's alone", () => {
  expect(probe.server.buildServerOnly).toBe("build-server-secret");
  expect(probe.server.buildServerOnlyMeta).toBe("build-server-secret");
  expect(probe.client.buildServerOnly).toBeUndefined();
  expect(probe.client.buildServerOnlyMeta).toBeUndefined();
});

test("NODE_ENV is production however it is read", () => {
  expect(probe.client.nodeEnv).toBe("production");
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
