import { initVal } from "@valbuild/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ValServerConfig } from "../ValServer";
import { createValTools } from "./createValTools";
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
  auth: { pat: "pat-not-a-real-token" },
  sessionId: null,
};

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
