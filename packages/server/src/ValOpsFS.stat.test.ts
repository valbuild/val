import fs from "fs";
import os from "os";
import path from "node:path";
import { initVal, type ModuleFilePath } from "@valbuild/core";
import { ValOpsFS } from "./ValOpsFS";

const { s, c, config } = initVal();
const MODULE_PATH = "/test/page.val.ts" as ModuleFilePath;

/**
 * A Studio of the release after the one content model echoes the `version`
 * the last `/stat` answered rather than `sourcesSha` and `schemaSha`, which
 * go from the wire a release later. The fs long poll then tells a new build
 * by the build the chain is relative to -- the NEWEST build made in this
 * process for this root, the one every instance answers with -- so a Studio
 * parked on the previous build's instance across a hot reload hears of the
 * new build once, and is not told "changed" on every poll after it. The same
 * for memory mode is in `ValOpsMemory.stat.test.ts`.
 */
describe("ValOpsFS getStat, echoing the version", () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-ops-fs-stat-"));
    fs.mkdirSync(path.join(rootDir, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "test", "page.val.ts"),
      `import { s, c } from "val.config";\nexport default c.define("${MODULE_PATH}", s.object({ title: s.string() }), { title: "start" });\n`,
    );
  });
  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  /** A build of the project at `rootDir` whose module says `title`. */
  const build = (title: string) =>
    new ValOpsFS(
      "http://localhost:4000",
      rootDir,
      {
        config,
        modules: [
          {
            def: async () => ({
              default: c.define(MODULE_PATH, s.object({ title: s.string() }), {
                title,
              }),
            }),
          },
        ],
      },
      { config, statPollingInterval: 300, statFilePollingInterval: 25 },
    );

  /** What the Studio echoes after an answer: its base, patches and version. */
  const echoOf = async (
    ops: ValOpsFS,
    answer: Awaited<ReturnType<ValOpsFS["getStat"]>>,
  ) => {
    if (answer.type === "error" || answer.type === "use-websocket") {
      throw new Error(`not a long-poll answer: ${answer.type}`);
    }
    return {
      baseSha: answer.baseSha,
      patches: answer.patches,
      jsonEntriesSha: answer.jsonEntriesSha,
      version: { build: await ops.chainBuild(), seq: answer.seq ?? 0 },
    };
  };

  test("a new build is a change once, and the poll parks after it", async () => {
    const old = build("start");
    const first = await old.getStat(null);
    const echo = await echoOf(old, first);
    expect((await old.getStat(echo)).type).toBe("no-change");

    // A newer build of the project, in this process: what HMR makes.
    const next = build("again");
    await next.getStat(null);
    const told = await old.getStat(echo);
    expect(told.type).toBe("did-change");
    expect(await old.chainBuild()).toBe(await next.chainBuild());

    // Parked on the old instance, echoing what it was told: nothing new.
    expect((await old.getStat(await echoOf(old, told))).type).toBe("no-change");
  });
});
