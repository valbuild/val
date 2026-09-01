import { initVal } from "@valbuild/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { transform } from "sucrase";
import synchronizedPrettier from "@prettier/sync";
import type { ValServerConfig } from "../ValServer";
import { createValTools } from "./createValTools";
import type { ValToolContext, ValTools } from "./types";

/**
 * One Val project on disk, for the tool suites to run against.
 *
 * Shared so the read and write suites cannot disagree about the fixture: a write
 * test that saved against different content than the read tests read would still
 * pass, and would stop telling anyone anything.
 *
 * Everything the suites do goes through `call(name, args, ctx)`, because that is
 * the whole surface a host has: an MCP server hands the name and the arguments
 * straight from the wire and gets back a `ValToolResult` it has to be able to
 * serialize. Reaching into `readTools()` directly would test the handlers while
 * skipping the two things most likely to break at that edge — argument parsing
 * and the state load that every handler depends on.
 */

export const PAGES_PATH = "/test/pages.val.ts";
export const ITEMS_PATH = "/test/items.val.ts";

/** Local fs mode: there is no credential to hold and no session to group by. */
export const CTX: ValToolContext = { auth: null, sessionId: null };

/**
 * The fixture content, written with `s` and `c` so the schemas and the source are
 * checked against each other here rather than at runtime in the tools.
 *
 * Small on purpose: a record of objects and an array of objects is enough to
 * exercise both container kinds, and holding no media keeps `validate_content`
 * honestly clean — an image would need bytes on disk to validate against.
 */
const PAGES_CODE = `
import { s, c } from "val.config";

export default c.define(
  "${PAGES_PATH}",
  s.record(s.object({ title: s.string({ minLength: 2 }), order: s.number() })),
  {
    home: { title: "Home", order: 1 },
    about: { title: "About", order: 2 },
  }
);
`;

const ITEMS_CODE = `
import { s, c } from "val.config";

export default c.define(
  "${ITEMS_PATH}",
  s.array(s.object({ label: s.string() })),
  [{ label: "First" }, { label: "Second" }]
);
`;

export function setup(): {
  tools: ValTools;
  /** Where the project lives, for a test that has to reach past the tools. */
  rootDir: string;
} {
  const { s, c, config } = initVal();
  // The OS temp dir, NOT the repo-local ".tmp" that other suites in this package
  // wipe on startup.
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-tools-test"));

  const evalModule = (code: string) =>
    new Script(
      transform(code, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") {
          return { s, c, config };
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p);
      },
      module: { exports: {} },
    });

  const sourceFiles: Record<string, string> = {
    [PAGES_PATH]: PAGES_CODE,
    [ITEMS_PATH]: ITEMS_CODE,
  };
  // ValOps reads the .val.ts files off disk to derive the base sha and to write
  // patches back, so the fixture has to exist as files and not only as modules.
  for (const [filePath, code] of Object.entries(sourceFiles)) {
    const absPath = path.join(rootDir, filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(
      absPath,
      synchronizedPrettier.format(code, { parser: "typescript" }),
    );
  }

  const options: ValServerConfig = {
    mode: "fs",
    cwd: rootDir,
    route: "/api/val",
    valContentUrl: process.env.VAL_CONTENT_URL || "http://localhost:4000",
    config,
  };

  const tools = createValTools(
    {
      config,
      modules: Object.values(sourceFiles).map((code) => ({
        def: async () => ({ default: evalModule(code) }),
      })),
    },
    options,
  );
  return { tools, rootDir };
}

/** Unwrap an `ok` result, failing with the tool's own message if it errored. */
export async function callOk(
  tools: ValTools,
  name: string,
  args: unknown,
): Promise<unknown> {
  const res = await tools.call(name, args, CTX);
  if (res.status !== "ok") {
    throw new Error(`${name} failed: ${res.code}: ${res.message}`);
  }
  return res.data;
}

export async function callErr(
  tools: ValTools,
  name: string,
  args: unknown,
): Promise<{ code: string; message: string }> {
  const res = await tools.call(name, args, CTX);
  if (res.status !== "error") {
    throw new Error(
      `Expected ${name} to fail, but it returned: ${JSON.stringify(res.data)}`,
    );
  }
  return { code: res.code, message: res.message };
}
