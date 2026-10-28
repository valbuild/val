import type { SketchpadT } from "@valbuild/shared/internal";
import type { SketchpadClient, SketchpadResult } from "./sketchpadClient";
import {
  SAVE_AFTER_MS,
  SketchpadSaver,
  type SaverEvents,
  type SaverProblem,
} from "./sketchpadSaver";

function sketchpad(
  version: number,
  text: string,
  archived = false,
): SketchpadT {
  return {
    id: "pad",
    page: "/",
    title: null,
    text,
    version,
    archived,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
  };
}

/**
 * A server that holds one sketchpad and checks versions as the real one
 * does, and answers only when told to: `release()` lets the oldest request
 * through, so a test decides what is in flight when.
 */
function fakeServer(start: SketchpadT) {
  let current = start;
  const sent: { baseVersion: number; text?: string }[] = [];
  const waiting: (() => void)[] = [];
  const answer = <T>(value: () => T): Promise<T> =>
    new Promise((resolve) => waiting.push(() => resolve(value())));
  const client: SketchpadClient = {
    list: () => Promise.resolve({ status: "ok", sketchpads: [] }),
    create: () => Promise.reject(new Error("not in these tests")),
    get: () =>
      Promise.resolve<SketchpadResult>({ status: "ok", sketchpad: current }),
    update: (change) => {
      sent.push({ baseVersion: change.baseVersion, text: change.text });
      return answer<SketchpadResult>(() => {
        if (change.baseVersion !== current.version) {
          return {
            status: "conflict",
            message: "moved on",
            sketchpad: current,
          };
        }
        if (current.archived && change.archived !== false) {
          return { status: "refused", message: "archived", errors: [] };
        }
        current = {
          ...current,
          text: change.text ?? current.text,
          archived: change.archived ?? current.archived,
          version: current.version + 1,
        };
        return { status: "ok", sketchpad: current };
      });
    },
  };
  return {
    client,
    sent,
    get current() {
      return current;
    },
    /** Someone else's write, straight to the server. */
    write(text: string, archived = false) {
      current = { ...current, text, archived, version: current.version + 1 };
      return current;
    },
    async release() {
      const next = waiting.shift();
      if (!next) {
        throw new Error("nothing is waiting");
      }
      next();
      // Let the saver's own awaits after the answer run.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    },
    get waiting() {
      return waiting.length;
    },
  };
}

function recorder() {
  const problems: SaverProblem[] = [];
  const replaced: string[] = [];
  const saved: number[] = [];
  const events: SaverEvents = {
    onReplace: (s) => replaced.push(s.text),
    onSaved: (s) => saved.push(s.version),
    onProblem: (p) => problems.push(p),
    onStatus: () => undefined,
  };
  return { events, problems, replaced, saved };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("SketchpadSaver", () => {
  test("saves after a pause, on the version it was typed on", async () => {
    const server = fakeServer(sketchpad(1, "# A\n"));
    const saver = new SketchpadSaver(
      server.current,
      server.client,
      recorder().events,
    );
    saver.edit("# AB\n");
    expect(server.sent).toEqual([]);
    jest.advanceTimersByTime(SAVE_AFTER_MS);
    expect(server.sent).toEqual([{ baseVersion: 1, text: "# AB\n" }]);
    await server.release();
    expect(server.current).toMatchObject({ version: 2, text: "# AB\n" });
  });

  test("typing during a slow save is sent after it, never beside it", async () => {
    const server = fakeServer(sketchpad(1, "A\n"));
    const r = recorder();
    const saver = new SketchpadSaver(server.current, server.client, r.events);
    saver.edit("AB\n");
    jest.advanceTimersByTime(SAVE_AFTER_MS);
    saver.edit("ABC\n");
    jest.advanceTimersByTime(SAVE_AFTER_MS);
    // One in flight: the second waits for the first's version.
    expect(server.sent).toHaveLength(1);
    await server.release();
    expect(server.sent).toEqual([
      { baseVersion: 1, text: "AB\n" },
      { baseVersion: 2, text: "ABC\n" },
    ]);
    await server.release();
    expect(server.current).toMatchObject({ version: 3, text: "ABC\n" });
    expect(r.problems).toEqual([]);
  });

  test("an edit that changes nothing is no new version", () => {
    const server = fakeServer(sketchpad(1, "A\n"));
    const saver = new SketchpadSaver(
      server.current,
      server.client,
      recorder().events,
    );
    saver.edit("A\n");
    saver.edit("AB\n");
    saver.edit("A\n");
    jest.advanceTimersByTime(SAVE_AFTER_MS * 2);
    expect(server.sent).toEqual([]);
  });

  test("a newer version replaces the screen when nothing is waiting", () => {
    const server = fakeServer(sketchpad(1, "A\n"));
    const r = recorder();
    const saver = new SketchpadSaver(server.current, server.client, r.events);
    saver.remote(server.write("The assistant's\n"));
    expect(r.replaced).toEqual(["The assistant's\n"]);
    expect(saver.version).toBe(2);
  });

  test("a newer version while typing: theirs is shown, mine is offered back", async () => {
    const server = fakeServer(sketchpad(1, "A\n"));
    const r = recorder();
    const saver = new SketchpadSaver(server.current, server.client, r.events);
    saver.edit("Mine\n");
    // Not over what was typed: the save is what decides.
    saver.remote(server.write("Theirs\n"));
    expect(r.replaced).toEqual([]);
    jest.advanceTimersByTime(SAVE_AFTER_MS);
    saver.edit("Mine, and more\n");
    await server.release();
    expect(r.replaced).toEqual(["Theirs\n"]);
    expect(r.problems).toEqual([
      expect.objectContaining({ kind: "conflict", mine: "Mine, and more\n" }),
    ]);
    // Put mine back: on top of theirs, so it is not refused again.
    saver.retry("Mine, and more\n");
    await server.release();
    expect(server.current).toMatchObject({
      version: 3,
      text: "Mine, and more\n",
    });
  });

  test("closed, a refused save still reaches someone", async () => {
    const server = fakeServer(sketchpad(1, "A\n"));
    const saver = new SketchpadSaver(
      server.current,
      server.client,
      recorder().events,
    );
    saver.edit("Last edit\n");
    server.write("Theirs\n");
    const closed = recorder();
    saver.setEvents(closed.events);
    void saver.flush();
    await server.release();
    expect(closed.problems).toEqual([
      expect.objectContaining({ kind: "conflict", mine: "Last edit\n" }),
    ]);
  });

  test("archived elsewhere: says so, and reopens with the edit in it", async () => {
    const server = fakeServer(sketchpad(1, "A\n"));
    const r = recorder();
    const saver = new SketchpadSaver(server.current, server.client, r.events);
    saver.remote(server.write("A\n", true));
    saver.edit("Kept\n");
    jest.advanceTimersByTime(SAVE_AFTER_MS);
    await server.release();
    expect(r.problems).toEqual([
      expect.objectContaining({ kind: "archived", mine: "Kept\n" }),
    ]);
    void saver.reopenWith("Kept\n");
    await server.release();
    expect(server.current).toMatchObject({ archived: false, text: "Kept\n" });
  });

  test("only a save that did not get through offers to try again", async () => {
    const failing: SketchpadClient = {
      ...fakeServer(sketchpad(1, "A\n")).client,
      update: () =>
        Promise.resolve<SketchpadResult>({
          status: "failed",
          message: "Val Build could not be reached",
        }),
    };
    const r = recorder();
    const saver = new SketchpadSaver(sketchpad(1, "A\n"), failing, r.events);
    saver.edit("B\n");
    await saver.flush();
    expect(r.problems).toEqual([
      expect.objectContaining({ kind: "failed", mine: "B\n", retryable: true }),
    ]);
  });
});
