import { Internal } from "@valbuild/core";
import { Sketchpad, type SketchpadT } from "@valbuild/shared/internal";
import fs from "fs";
import path from "path";
import {
  applySketchpadChange,
  byUpdatedAt,
  matchesFilter,
  newSketchpad,
  summaryOf,
  type SketchpadStore,
} from "./SketchpadStore";

const ID = /^[0-9a-f-]{36}$/;

/**
 * Sketchpads in `fs` mode: one JSON file each, in `.val/sketchpads/` beside
 * the patch store (and nothing to do with it -- a sketchpad is not an edit
 * and is never published).
 *
 * A file is replaced by writing a temporary one and renaming it over, so a
 * reader never sees half of one. Changes to one sketchpad are queued in this
 * process, so its version check and its write are one step. Two dev servers
 * writing the same sketchpad at the same instant could still race; that is
 * a cost local development can carry, and the content service, which hosts
 * every real project's, does the check in one database statement.
 */
export function createFsSketchpadStore(
  rootDir: string,
  now: () => Date = () => new Date(),
): SketchpadStore {
  const dir = path.join(rootDir, ".val", "sketchpads");
  const fileOf = (id: string) => path.join(dir, `${id}.json`);
  const queues = new Map<string, Promise<unknown>>();

  const read = async (id: string): Promise<SketchpadT | null> => {
    if (!ID.test(id)) {
      return null;
    }
    let raw: string;
    try {
      raw = await fs.promises.readFile(fileOf(id), "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = Sketchpad.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Reported below, as for a file that parsed and was not a sketchpad.
    }
    Internal.log.warn(
      `${fileOf(id)} is not a sketchpad, so it is left out. Move it away to stop this message.`,
    );
    return null;
  };

  const write = async (sketchpad: SketchpadT) => {
    await fs.promises.mkdir(dir, { recursive: true });
    const temporary = `${fileOf(sketchpad.id)}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(sketchpad, null, 2));
    await fs.promises.rename(temporary, fileOf(sketchpad.id));
  };

  /** Runs `task` after every earlier change to `id` has finished. */
  const queued = <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  };

  return {
    async list(filter) {
      let names: string[];
      try {
        names = await fs.promises.readdir(dir);
      } catch {
        return [];
      }
      const all = await Promise.all(
        names
          .filter((name) => name.endsWith(".json"))
          .map((name) => read(name.slice(0, -".json".length))),
      );
      return all
        .filter((sketchpad): sketchpad is SketchpadT => sketchpad !== null)
        .map(summaryOf)
        .filter((sketchpad) => matchesFilter(sketchpad, filter))
        .sort(byUpdatedAt);
    },
    get: read,
    async create(input) {
      const sketchpad = newSketchpad(input, now());
      await write(sketchpad);
      return sketchpad;
    },
    update(id, change) {
      return queued(id, async () => {
        const result = applySketchpadChange(await read(id), change, now());
        if (result.status === "updated") {
          await write(result.sketchpad);
        }
        return result;
      });
    },
  };
}
