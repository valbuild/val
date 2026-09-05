import { initVal } from "@valbuild/core";
import type { ModuleFilePath, SelectorSource, ValModule } from "@valbuild/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { transform } from "sucrase";
import synchronizedPrettier from "@prettier/sync";
import { createValOps, type ValServerConfig } from "@valbuild/server";
import { createValTools, loadState } from "./createValTools";
import type { ValToolDeps, ValToolImpl } from "./defineTool";
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

// Branded once here rather than at each use. `ModuleFilePath` is a branded
// string with no constructor — the assertion is the codebase's own idiom for
// one — and doing it in the fixture means the suites can hand these straight to
// anything that takes a real `ModuleFilePath`, not only to `call`'s `unknown`.
export const PAGES_PATH = "/test/pages.val.ts" as ModuleFilePath;
export const ITEMS_PATH = "/test/items.val.ts" as ModuleFilePath;
export const GALLERY_PATH = "/test/gallery.val.ts" as ModuleFilePath;
export const ENCODED_GALLERY_PATH =
  "/test/encodedGallery.val.ts" as ModuleFilePath;
export const MEDIA_PATH = "/test/media.val.ts" as ModuleFilePath;

/** Local fs mode: there is no credential to hold and no session to group by. */
export const CTX: ValToolContext = { auth: null, sessionId: null };

/**
 * The fixture content, written with `s` and `c` so the schemas and the source are
 * checked against each other here rather than at runtime in the tools.
 *
 * Small on purpose: a record of objects and an array of objects is enough to
 * exercise both container kinds. The media modules hold no images to begin
 * with, which keeps `validate_content` honestly clean — an image with no bytes
 * on disk is a validation error, so an empty gallery and a null field are the
 * only starting states that do not make every other suite report one.
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

/**
 * An empty gallery, and one that asks for its uploads to be converted.
 *
 * Two modules rather than one option, for the reason `encodedImages.val.ts` in
 * the example app gives: a suite that asserts on an uploaded ref asserts on the
 * extension and the content hash too, so turning encoding on in the shared
 * gallery would change what every one of them uploads.
 *
 * `maxWidth`/`maxHeight` are tiny so a fixture image small enough to write
 * inline still exercises the downscale.
 */
const GALLERY_CODE = `
import { s, c } from "val.config";

export default c.define(
  "${GALLERY_PATH}",
  s.images({ directory: "/public/val/test" }),
  {}
);
`;

const ENCODED_GALLERY_CODE = `
import { s, c } from "val.config";

export default c.define(
  "${ENCODED_GALLERY_PATH}",
  s.images({
    directory: "/public/val/encoded",
    encode: { type: "webp", maxWidth: 8, maxHeight: 8 },
  }),
  {}
);
`;

/**
 * A plain image field, and one backed by the gallery above.
 *
 * The gallery-backed one is what makes the two-module write path testable:
 * `s.image(galleryVal)` stores only the path on the field and keeps the
 * dimensions in the gallery, so uploading to it has to write both.
 */
const MEDIA_CODE = `
import { s, c } from "val.config";
import gallery from "./gallery.val";

export default c.define(
  "${MEDIA_PATH}",
  s.object({
    hero: s.image().nullable(),
    thumbnail: s.image(gallery).nullable(),
  }),
  { hero: null, thumbnail: null }
);
`;

export function setup(options?: {
  /**
   * Tools the host would have built itself — the image tool, in practice.
   *
   * Passed through to `createValTools` rather than called directly, because the
   * whole surface a host has is `call(name, args, ctx)`: a suite that reached
   * into the handler would skip argument parsing and the state load, which are
   * the two things most likely to break at that edge.
   */
  extraTools?: ValToolImpl[];
}): {
  tools: ValTools;
  /** Where the project lives, for a test that has to reach past the tools. */
  rootDir: string;
  /**
   * What a tool handler is handed, for a caller of your choosing.
   *
   * The one thing `tools.call` cannot give a test: this fixture is fs mode, and
   * fs mode refuses every credential before a handler runs (deliberately — see
   * `createValTools`). So the behaviour that depends on *who* is calling has no
   * route through `call` here, and the alternative to this seam is no coverage
   * of it at all.
   *
   * It is the registry's own `loadState` over the registry's own ops, so a
   * handler called with these sees what it would see in proxy mode. What is
   * faked is the caller, which is the point.
   */
  depsFor: (ctx: ValToolContext) => Promise<ValToolDeps>;
} {
  const { s, c, config } = initVal();
  // The OS temp dir, NOT the repo-local ".tmp" that other suites in this package
  // wipe on startup.
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-tools-test"));

  /**
   * Evaluate one fixture module, resolving the two imports it can have.
   *
   * `val.config` is the usual shim. A relative import is the other one, and it
   * is not decoration: `s.image(galleryVal)` takes the gallery MODULE, so a
   * gallery-backed field cannot be written without one module importing
   * another. Memoised, because evaluating the gallery twice would give the
   * field a different module object than the registry has, and the reference is
   * what ties them together.
   */
  const evaluated = new Map<string, ValModule<SelectorSource>>();
  const evalModule = (filePath: string): ValModule<SelectorSource> => {
    const cached = evaluated.get(filePath);
    if (cached !== undefined) {
      return cached;
    }
    const code = sourceFiles[filePath];
    const value: ValModule<SelectorSource> = new Script(
      transform(code, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") {
          return { s, c, config };
        }
        if (p.startsWith(".")) {
          // Written the way a real project writes it — `./gallery.val`, a
          // sibling — so the file on disk is a file a person could have
          // authored, and resolved the way TypeScript would.
          return {
            // `__esModule`, or sucrase's interop wraps this in a SECOND
            // `default` and `s.image(gallery)` is handed `{ default: module }`
            // — which has no module path, so it is read as an options object
            // and the field quietly stops being gallery-backed.
            __esModule: true,
            default: evalModule(
              `${path.posix.join(path.posix.dirname(filePath), p)}.ts`,
            ),
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p);
      },
      module: { exports: {} },
    });
    evaluated.set(filePath, value);
    return value;
  };

  const sourceFiles: Record<string, string> = {
    [PAGES_PATH]: PAGES_CODE,
    [ITEMS_PATH]: ITEMS_CODE,
    [GALLERY_PATH]: GALLERY_CODE,
    [ENCODED_GALLERY_PATH]: ENCODED_GALLERY_CODE,
    [MEDIA_PATH]: MEDIA_CODE,
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

  const serverConfig: ValServerConfig = {
    mode: "fs",
    cwd: rootDir,
    route: "/api/val",
    valContentUrl: process.env.VAL_CONTENT_URL || "http://localhost:4000",
    config,
  };

  const valModules = {
    config,
    modules: Object.keys(sourceFiles).map((filePath) => ({
      def: async () => ({ default: evalModule(filePath) }),
    })),
  };
  const tools = createValTools(valModules, serverConfig, options?.extraTools);
  // Built from the same modules and options as the registry's own, and against
  // the same working tree, so a save made through it is a save the tools can
  // then read back.
  const ops = createValOps(valModules, serverConfig);
  const depsFor = async (ctx: ValToolContext): Promise<ValToolDeps> => {
    const state = await loadState(ops);
    if (state.status === "error") {
      throw new Error(
        `Could not load the fixture's state: ${JSON.stringify(state.result)}`,
      );
    }
    return { ops, ctx, state: state.state };
  };
  return { tools, rootDir, depsFor };
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
