import fs from "fs";
import os from "os";
import path from "path";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { ValOpsFS } from "./ValOpsFS";

/**
 * The head in fs mode, where "has the chain moved?" is `.val/patches.seq`.
 * Removing `.val` by hand starts that counter again, and a reader holding a
 * chain at the number it comes back to must not take it for "nothing moved".
 */

const { s, c, config } = initVal();
const HOME = "/content/home.val.ts" as ModuleFilePath;
const homeVal = c.define(HOME, s.object({ title: s.string() }), {
  title: "Hello",
});

describe("the head in fs mode", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-head-fs-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a patch store removed by hand is read again, though its count came back to the one held", async () => {
    const valModules: ValModules = {
      config,
      modules: [{ def: async () => ({ default: homeVal }) }],
    };
    const ops = new ValOpsFS("http://localhost:4000", root, valModules, {
      config,
      disableFilePolling: true,
      disableFileWatcher: true,
    });
    let n = 0;
    const edit = async (title: string) => {
      const patchId =
        `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as PatchId;
      const res = await ops.createPatch(
        HOME,
        [{ op: "replace", path: ["title"], value: title }],
        patchId,
        { type: "head", headBaseSha: await ops.getBaseSha() },
        null,
        null,
      );
      if (result.isErr(res)) throw new Error(JSON.stringify(res.error));
    };
    const title = async () => {
      const read = await ops.head.module(HOME);
      if ("error" in read || read.ok === null) throw new Error("no module");
      return (read.ok.module.content.source as { title: string }).title;
    };

    await edit("Before");
    expect(await title()).toBe("Before");
    const held = await ops.chainSeq();

    fs.rmSync(path.join(root, ".val"), { recursive: true, force: true });
    let seq = await ops.chainSeq();
    while (seq !== held) {
      await edit("After");
      seq = await ops.chainSeq();
      if (seq !== null && held !== null && seq > held) {
        throw new Error(`the count passed ${held} without landing on it`);
      }
    }
    expect(await title()).toBe("After");
  });
});
