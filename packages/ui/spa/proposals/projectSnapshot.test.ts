import { createCodeClients } from "./codeClients";
import { FRESH_MS, OWN_STAGING_GRACE_MS } from "./projectSnapshot";
import {
  readProjectInstructions,
  runCodeTool,
  type CodeToolDeps,
} from "./proposalCode";
import { createProjectSnapshot } from "./projectSnapshot";
import type { ProposalStaged } from "./proposalsClient";

/*
 * The chat's snapshot of the project (`projectSnapshot.ts`), driven through
 * the code tools as `useAI` wires them (`createCodeClients`, `runCodeTool`)
 * with the network as the only stand-in: a content service that keeps a
 * proposal's files, counts what it is asked, and moves a `seq` the test
 * hands to the tab when it says the tab has heard.
 *
 * `codeToolRequests.scenario.test.ts` counts the same against Val's real
 * server; here the order of events is the test's, which a real server's is
 * not.
 */

const NAME = "0123456789abcdef0123";
const FILES = `/api/val/proposals-api/${NAME}/files`;
const SOURCE = "/api/val/publish-api/project-source";
const HERO = "src/Hero.tsx";

const service = (
  over: { site?: Record<string, string>; own?: Record<string, string> } = {},
) => {
  const state = {
    site: over.site ?? { "AGENTS.md": "Use tabs.", "src/site.ts": "site" },
    siteTag: 1,
    own: { [HERO]: "one two three", ...over.own } as Record<
      string,
      string | null
    >,
    /** The content service's own `seq`. */
    seq: 1,
    /** The `seq` the tab has heard. */
    heard: 1 as number | null,
    asked: [] as string[],
    /** Stagings refused with this, while set. */
    refuse: null as { status: number; body: unknown } | null,
    /** What a staging says of a save before it. */
    savedFirst: false as boolean | undefined,
    /** Files Val's server saves before the next staging, as a save writes them. */
    savesFirst: {} as Record<string, string>,
    /** The socket outruns the relay: the tab hears a staging before its answer. */
    hearsOwn: false,
    /** Reads of the proposal's files wait for this, while set. */
    holdReads: null as Promise<void> | null,
  };
  const staged = (): ProposalStaged => ({
    files: Object.keys(state.own).sort(),
    inputs: `inputs-${state.seq}`,
    buildRequired: true,
  });
  const json = (status: number, body: unknown, headers = {}) =>
    new Response(status === 304 ? null : JSON.stringify(body), {
      status,
      headers,
    });
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    state.asked.push(`${method} ${path}`);
    if (path === SOURCE) {
      const tag = `"site-${state.siteTag}"`;
      const held = new Headers(init?.headers).get("If-None-Match");
      if (held === tag) return json(304, null);
      return json(200, { files: state.site }, { ETag: tag });
    }
    if (path === FILES && method === "GET") {
      const answer = { files: { ...state.own }, staged: staged() };
      if (state.holdReads !== null) await state.holdReads;
      return json(200, answer);
    }
    if (path === FILES && method === "POST") {
      if (state.refuse !== null) {
        return json(state.refuse.status, state.refuse.body);
      }
      const body: unknown = JSON.parse(String(init?.body));
      if (
        typeof body === "object" &&
        body !== null &&
        "files" in body &&
        typeof body.files === "object"
      ) {
        Object.assign(state.own, state.savesFirst, body.files);
        state.savesFirst = {};
      }
      state.seq++;
      if (state.hearsOwn) {
        state.heard = state.seq;
        clients.snapshot.seqMoved();
      }
      return json(200, {
        commit: `c${state.seq}`,
        staged: staged(),
        ...(state.savedFirst !== undefined
          ? { savedFirst: state.savedFirst }
          : {}),
      });
    }
    return json(404, { message: `Nothing at ${method} ${path}` });
  };
  const clients = createCodeClients({
    api: "/api/val",
    fetchImpl,
    seq: () => state.heard,
  });
  const offered = { times: 0 };
  const never = (): never => {
    throw new Error("not a tool of this test");
  };
  const deps = (proposal: { name: string } | null): CodeToolDeps => ({
    proposal,
    client: clients.proposals,
    siteSource: clients.siteSource,
    snapshot: clients.snapshot,
    build: {
      start: never,
      running: () => null,
      report: never,
      cancel: () => false,
    },
    typecheck: never,
    offerProposal: () => {
      offered.times++;
    },
  });
  return {
    state,
    clients,
    offered,
    run: (tool: string, args: unknown, on: "proposal" | "site" = "proposal") =>
      runCodeTool(tool, args, deps(on === "site" ? null : { name: NAME })),
    /** What was asked since this was last called. */
    asked: () => state.asked.splice(0),
    /** The tab hears where the content service is. */
    hear: () => {
      state.heard = state.seq;
      clients.snapshot.seqMoved();
    },
    /** Someone else stages `files`. */
    someoneStages: (files: Record<string, string>) => {
      Object.assign(state.own, files);
      state.seq++;
    },
  };
};
const edit = (from: string, to: string) => ({
  path: HERO,
  old_string: from,
  new_string: to,
});
const textOf = (answer: { result: unknown }): unknown =>
  typeof answer.result === "object" &&
  answer.result !== null &&
  "text" in answer.result
    ? answer.result.text
    : answer.result;

describe("the project the code tools read, held in the tab", () => {
  test("in a proposal: asked for once, both parts beside each other, then read from the tab", async () => {
    const s = service();
    expect(textOf(await s.run("read_file", { path: HERO }))).toBe(
      "one two three",
    );
    expect(s.asked().sort()).toEqual([`GET ${FILES}`, `GET ${SOURCE}`]);

    await s.run("read_file", { path: "src/site.ts" });
    await s.run("search_code", { query: "two" });
    await s.run("list_files", {});
    await s.run("lint", {});
    await s.run("format_files", { write: false });
    expect(s.asked()).toEqual([]);
  });

  test("the project's instructions are read from it too", async () => {
    const s = service();
    await s.run("list_files", {});
    s.asked();
    expect(
      await readProjectInstructions({
        proposal: { name: NAME },
        client: s.clients.proposals,
        siteSource: s.clients.siteSource,
        snapshot: s.clients.snapshot,
      }),
    ).toContain("Use tabs.");
    expect(s.asked()).toEqual([]);
  });

  test("ON THE SITE: one request, then none; a publish is seen; a write is refused without asking anything", async () => {
    const s = service();
    expect(
      textOf(await s.run("read_file", { path: "src/site.ts" }, "site")),
    ).toBe("site");
    expect(s.asked()).toEqual([`GET ${SOURCE}`]);
    await s.run("search_code", { query: "site" }, "site");
    await s.run("list_files", {}, "site");
    expect(s.asked()).toEqual([]);

    // A publish moves the site's `seq`, and its source.
    s.state.site = { ...s.state.site, "src/site.ts": "published" };
    s.state.siteTag++;
    s.state.seq++;
    s.hear();
    expect(
      textOf(await s.run("read_file", { path: "src/site.ts" }, "site")),
    ).toBe("published");
    expect(s.asked()).toEqual([`GET ${SOURCE}`]);

    const written = await s.run("edit_file", edit("one", "1"), "site");
    expect(written.isError).toBe(true);
    expect(s.offered.times).toBe(1);
    expect(s.asked()).toEqual([]);
  });

  test("an edit is one request, and three in one reply are three: each reads what the one before wrote", async () => {
    const s = service();
    await s.run("list_files", {});
    s.asked();

    const answers = await Promise.all([
      s.run("edit_file", edit("one", "1")),
      s.run("edit_file", edit("two", "2")),
      s.run("edit_file", edit("three", "3")),
    ]);
    expect(answers.map((answer) => answer.isError)).toEqual([
      false,
      false,
      false,
    ]);
    expect(s.asked()).toEqual([
      `POST ${FILES}`,
      `POST ${FILES}`,
      `POST ${FILES}`,
    ]);
    expect(s.state.own[HERO]).toBe("1 2 3");
    expect(textOf(await s.run("read_file", { path: HERO }))).toBe("1 2 3");
    expect(s.asked()).toEqual([]);
  });

  test("the tab's own staging moves `seq`: the files are read again behind it, and the next edit does not wait for that", async () => {
    const s = service();
    s.state.hearsOwn = true;
    await s.run("list_files", {});
    s.asked();

    // The re-read behind the first edit is slow.
    let release = () => {};
    s.state.holdReads = new Promise((resolve) => {
      release = resolve;
    });
    await s.run("edit_file", edit("one", "1"));
    expect(s.asked()).toEqual([`POST ${FILES}`, `GET ${FILES}`]);

    const next = await s.run("edit_file", edit("two", "2"));
    expect(next.isError).toBe(false);
    expect(s.asked()).toEqual([`POST ${FILES}`]);
    expect(s.state.own[HERO]).toBe("1 2 three");

    // It lands, was overlapped by the second edit, and is made again by
    // itself: the model's next read finds it done.
    s.state.holdReads = null;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.asked()).toEqual([`GET ${FILES}`]);
    expect(textOf(await s.run("read_file", { path: HERO }))).toBe("1 2 three");
    expect(s.asked()).toEqual([]);
  });

  test("SOMEONE ELSE'S CHANGE IS NOT OVERWRITTEN: once the tab hears `seq` moved, an edit is made from their text", async () => {
    const s = service();
    await s.run("read_file", { path: HERO });
    s.asked();

    s.someoneStages({ [HERO]: "one two three, and theirs" });
    s.hear();
    const mine = await s.run("edit_file", edit("one", "1"));
    expect(mine.isError).toBe(false);
    const asked = s.asked();
    expect(asked).toContain(`GET ${FILES}`);
    expect(asked[asked.length - 1]).toBe(`POST ${FILES}`);
    expect(s.state.own[HERO]).toBe("1 two three, and theirs");
  });

  test("behind the tab's own staging, what is held is used for a moment only: after it, a read waits for the re-read, which has their change", async () => {
    let now = 1_000;
    const own: Record<string, string | null> = { [HERO]: "one two three" };
    let seq: number | null = 1;
    let release = () => {};
    let held: Promise<void> | null = null;
    const snapshot = createProjectSnapshot({
      client: {
        files: async () => {
          const files = { ...own };
          if (held !== null) await held;
          return {
            files,
            staged: { files: [HERO], inputs: "i", buildRequired: true },
          };
        },
        stageFiles: async (_name, files) => {
          Object.assign(own, files);
          return {
            commit: "c",
            staged: { files: [HERO], inputs: "i", buildRequired: true },
            savedFirst: false,
          };
        },
      },
      siteSource: async () => ({}),
      seq: () => seq,
      now: () => now,
    });
    await snapshot.read(NAME);
    await snapshot.stage(NAME, { "src/mine.ts": "mine" });
    // Someone else stages too, and `seq` moves: the re-read starts, slowly.
    own[HERO] = "theirs";
    held = new Promise((resolve) => {
      release = resolve;
    });
    seq = 3;
    snapshot.seqMoved();
    // Within the grace, what is held is still used, without waiting...
    now += OWN_STAGING_GRACE_MS - 1;
    expect((await snapshot.read(NAME)).project[HERO]).toBe("one two three");
    // ...and after it, never: the read waits for the re-read.
    now += 1;
    const read = snapshot.read(NAME);
    release();
    expect((await read).project).toEqual({
      [HERO]: "theirs",
      "src/mine.ts": "mine",
    });
  });

  test("a staging that saved content first, or did not say, leaves the files in doubt: the next read asks", async () => {
    for (const savedFirst of [true, undefined]) {
      const s = service({ own: { "content/home.val.ts": "before" } });
      s.state.savedFirst = savedFirst;
      await s.run("list_files", {});
      s.asked();
      // The server's save writes a file this tab did not.
      s.state.savesFirst = { "content/home.val.ts": "saved" };
      await s.run("edit_file", edit("one", "1"));
      expect(
        textOf(await s.run("read_file", { path: "content/home.val.ts" })),
      ).toBe("saved");
      expect(s.asked()).toContain(`GET ${FILES}`);
    }
  });

  test("a staging that fails leaves nothing held", async () => {
    const s = service();
    await s.run("list_files", {});
    s.state.refuse = { status: 500, body: { message: "Content is down." } };
    const failed = await s.run("edit_file", edit("one", "1"));
    expect(failed).toEqual({
      isError: true,
      result: { success: false, error: "Content is down." },
    });
    s.asked();
    await s.run("read_file", { path: HERO });
    expect(s.asked()).toContain(`GET ${FILES}`);
  });

  test("code mode turned off since the tab heard: the server's refusal is answered as asking first would have been", async () => {
    const s = service();
    s.state.refuse = {
      status: 409,
      body: {
        message:
          "Code mode is off in this proposal, so its code is not changed.",
        details: {
          code: "code-mode-off",
          changedBy: "profile-kari",
          changedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        },
      },
    };
    const asks = { codeMode: 0 };
    const refused = await runCodeTool("edit_file", edit("one", "1"), {
      proposal: { name: NAME },
      client: s.clients.proposals,
      siteSource: s.clients.siteSource,
      snapshot: s.clients.snapshot,
      build: {
        start: () => Promise.reject(new Error("not built")),
        running: () => null,
        report: () => ({ status: "idle", last: null }),
        cancel: () => false,
      },
      typecheck: async () => ({ status: "nothing-staged" }),
      offerProposal: () => {},
      codeMode: async () => {
        asks.codeMode++;
        return { on: true };
      },
      // The top bar last read it as on.
      codeModeHere: () => true,
      nameOf: (id) => (id === "profile-kari" ? "Kari Nordmann" : null),
    });
    expect(asks.codeMode).toBe(0);
    expect(refused).toEqual({
      isError: true,
      result: {
        success: false,
        error: expect.stringMatching(
          /^Code mode is off in this proposal: Kari Nordmann turned it off 5 minutes ago, so its code cannot be changed now\. Nothing was written\. .*request_code_mode/,
        ),
      },
    });
  });

  test("without a `seq`, and after it has been held too long, every read asks", async () => {
    const s = service();
    s.state.heard = null;
    await s.run("read_file", { path: HERO });
    s.asked();
    await s.run("read_file", { path: HERO });
    expect(s.asked().sort()).toEqual([`GET ${FILES}`, `GET ${SOURCE}`]);

    let now = 0;
    const asked: string[] = [];
    const snapshot = createProjectSnapshot({
      client: {
        files: async () => {
          asked.push("files");
          return {
            files: {},
            staged: { files: [], inputs: null, buildRequired: false },
          };
        },
      },
      siteSource: async () => {
        asked.push("site");
        return {};
      },
      seq: () => 1,
      now: () => now,
    });
    await snapshot.read(NAME);
    now = FRESH_MS - 1;
    await snapshot.read(NAME);
    expect(asked.sort()).toEqual(["files", "site"]);
    now = FRESH_MS;
    await snapshot.read(NAME);
    expect(asked.sort()).toEqual(["files", "files", "site", "site"]);
  });
});
