import fs from "fs";
import { randomBytes } from "crypto";

/**
 * The fs-mode patch store's `seq`: how far along the project's changes are,
 * bumped by every write, delete and publish, and once by each new build. See
 * `ProjectVersion` in `@valbuild/shared/internal` and
 * `architecture/patch-store.md`.
 *
 * In `.val/patches.seq`, BESIDE the lock rather than inside `.val/patches/`:
 * delete-all and reset rename that whole directory away, and a counter that
 * went with it would start again from zero -- an answer from after the reset
 * would then read as older than one from before it.
 *
 * Plain JSON (`{ "seq": 12, "build": "…", "epoch": "…" }`), written whole
 * and renamed into place, so a reader never sees half of it. Only ever
 * written under `.val/patches.lock`.
 *
 * Removing `.val` by hand starts it from zero all the same, so the file also
 * carries an `epoch`, made when the file is: `seq` orders answers only within
 * one epoch, and "has the chain moved?" compares both (`ValHead.sync`).
 */
export const PATCH_SEQ_FILE_NAME = "patches.seq";

export type PatchSeq = {
  seq: number;
  /** The build that last bumped it on starting, so the next one bumps once. */
  build: string | null;
  /**
   * Made at random when the file is created: a counter that started again
   * (`.val` removed) has another, so a `seq` that came back to the number a
   * reader held is not read as "nothing moved". `null` for a file written
   * before it, or none.
   */
  epoch: string | null;
};

/** The counter as it stands. Missing or unreadable is zero: nothing counted yet. */
export function readPatchSeq(file: string): PatchSeq {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { seq: 0, build: null, epoch: null };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "seq" in parsed &&
      typeof parsed.seq === "number"
    ) {
      const build =
        "build" in parsed && typeof parsed.build === "string"
          ? parsed.build
          : null;
      const epoch =
        "epoch" in parsed && typeof parsed.epoch === "string"
          ? parsed.epoch
          : null;
      return { seq: parsed.seq, build, epoch };
    }
  } catch {
    // A torn or foreign file: counted from zero again, which only costs an
    // answer its ordering against answers from before.
  }
  return { seq: 0, build: null, epoch: null };
}

/**
 * One more, and the new value. The caller holds the patch lock. `build` names
 * the build bumping it for starting; a write leaves the build as it was.
 */
export function bumpPatchSeq(file: string, build?: string): number {
  const current = readPatchSeq(file);
  const next: PatchSeq = {
    seq: current.seq + 1,
    build: build ?? current.build,
    epoch: current.epoch ?? randomBytes(8).toString("hex"),
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, file);
  return next.seq;
}
