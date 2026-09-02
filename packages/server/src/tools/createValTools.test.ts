import { initVal } from "@valbuild/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ValServerConfig } from "../ValServer";
import { createValTools } from "./createValTools";
import { authorIdFromVerifiedSubject } from "./types";
import type { ValToolContext, ValTools } from "./types";

/**
 * Who the registry lets in, and whose credential it uses once it has.
 *
 * These need no content fixture and reach no network: both refusals happen
 * before any content is loaded, which is itself the property under test. A
 * project that has to be readable before a missing credential is noticed has
 * already done work on an unauthenticated caller's behalf.
 */

const NO_AUTH: ValToolContext = { auth: null, sessionId: null };
const WITH_PAT: ValToolContext = {
  auth: { type: "pat", pat: "pat-not-a-real-token" },
  sessionId: null,
};

function verified(...scopes: string[]): ValToolContext {
  return {
    auth: {
      type: "verified-profile",
      profileId: authorIdFromVerifiedSubject("profile-123"),
      scopes,
    },
    sessionId: null,
  };
}

function fsTools(): ValTools {
  const { config } = initVal();
  const options: ValServerConfig = {
    mode: "fs",
    // Empty: nothing here should get far enough to read it.
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), "val-tools-auth")),
    route: "/api/val",
    valContentUrl: "http://localhost:4000",
    config,
  };
  return createValTools({ config, modules: [] }, options);
}

function httpTools(): ValTools {
  const { config } = initVal();
  const options: ValServerConfig = {
    mode: "http",
    route: "/api/val",
    // A URL that would fail to connect, so a test that got as far as using it
    // would fail rather than pass by talking to something real.
    valContentUrl: "http://127.0.0.1:1/never",
    apiKey: "app-api-key-must-not-be-used",
    project: "test/project",
    commit: "0".repeat(40),
    branch: "main",
    config,
  };
  return createValTools({ config, modules: [] }, options);
}

describe("authorization", () => {
  test("proxy mode refuses a call with no credential", async () => {
    const res = await httpTools().call("get_all_schema", {}, NO_AUTH);

    // The point is that it does NOT fall back to the app's own API key, which
    // can reach every project that key is scoped to rather than only the ones
    // this caller may see.
    expect(res).toEqual({
      status: "error",
      code: "forbidden",
      message: expect.stringContaining("personal access token"),
    });
  });

  test("proxy mode refuses a write with no credential too", async () => {
    // Same gate for reads and writes: there is one place this is decided, so a
    // new tool cannot arrive unguarded.
    const res = await httpTools().call(
      "create_patch",
      { moduleFilePath: "/test/pages.val.ts", patch: [] },
      NO_AUTH,
    );

    expect(res.status).toBe("error");
    expect(res.status === "error" && res.code).toBe("forbidden");
  });

  test("an unknown tool is not-found before authorization is considered", async () => {
    // Deliberate: which tools exist is not a secret, and answering "no such
    // tool" for a typo is more useful than "forbidden". Nothing is read and no
    // credential is used to answer it.
    const res = await httpTools().call("nope", {}, NO_AUTH);

    expect(res.status === "error" && res.code).toBe("unknown-tool");
  });

  test("fs mode refuses a credential rather than ignoring it", async () => {
    const res = await fsTools().call("get_all_schema", {}, WITH_PAT);

    // A host that believes it is authenticating must not silently get direct
    // filesystem access instead: fs mode writes straight to the working tree,
    // with no backend permission check anywhere in the path.
    expect(res).toEqual({
      status: "error",
      code: "unsupported",
      message: expect.stringContaining("local filesystem mode"),
    });
  });

  test("fs mode serves a call with no credential", async () => {
    // The complement of the test above, so "refuses a credential" cannot be
    // passing because fs mode refuses everything.
    const res = await fsTools().call("get_all_schema", {}, NO_AUTH);

    expect(res).toEqual({ status: "ok", data: {} });
  });
});

describe("scopes", () => {
  test("a write is refused when the token may only read", async () => {
    const res = await httpTools().call(
      "create_patch",
      { moduleFilePath: "/test/pages.val.ts", patch: [] },
      verified("val:read"),
    );

    // Refused here rather than by the backend, and that is the point of
    // checking twice: a token that may only read never reaches the code that
    // builds a patch.
    expect(res).toEqual({
      status: "error",
      code: "forbidden",
      message: expect.stringContaining("val:write"),
    });
  });

  test("a write is allowed past the gate when the token has val:write", async () => {
    const res = await httpTools().call(
      "create_patch",
      { moduleFilePath: "/test/pages.val.ts", patch: [] },
      verified("val:read", "val:write"),
    );

    // It still fails — the backend URL is deliberately unreachable — but the
    // failure must not be the authorization gate, or this test would pass just
    // as well with the gate refusing everything.
    expect(res.status).toBe("error");
    expect(res.status === "error" && res.code).not.toBe("forbidden");
  });

  test("a read is allowed past the gate with only val:read", async () => {
    const res = await httpTools().call(
      "get_all_schema",
      {},
      verified("val:read"),
    );

    expect(res.status === "error" && res.code).not.toBe("forbidden");
  });

  test("the message says what was granted, so the fix is visible", async () => {
    const res = await httpTools().call(
      "create_patch",
      { moduleFilePath: "/test/pages.val.ts", patch: [] },
      verified("val:read"),
    );

    expect(res.status === "error" && res.message).toContain("val:read");
  });

  test("fs mode refuses a verified profile too", async () => {
    const res = await fsTools().call(
      "get_all_schema",
      {},
      verified("val:read", "val:write"),
    );

    // Same reasoning as the PAT case: a host that believes it is
    // authenticating must not silently get direct filesystem access, and which
    // *kind* of credential it holds does not change that.
    expect(res).toEqual({
      status: "error",
      code: "unsupported",
      message: expect.stringContaining("local filesystem mode"),
    });
  });

  test("a PAT is not scope-checked here", async () => {
    // A PAT carries no scopes in this process: the backend resolves it and
    // decides. Inventing a default would be this app claiming an authority it
    // does not have — so the gate must not refuse a write on a PAT for want of
    // a scope it was never given.
    const res = await httpTools().call(
      "create_patch",
      { moduleFilePath: "/test/pages.val.ts", patch: [] },
      WITH_PAT,
    );

    expect(res.status).toBe("error");
    expect(res.status === "error" && res.code).not.toBe("forbidden");
  });
});
