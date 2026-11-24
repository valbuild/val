import { expect, test } from "@playwright/test";
import { mock, sessionCookie } from "./httpMode";
import { openChatStudio, send, toolCalls } from "./assistant";

/**
 * An assistant turn's trace, read as a person reads it: from the console.
 *
 * `aiTurnTrace.ts` records where a turn's time went from the assistant's
 * socket. Its arithmetic is unit tested; what only a browser shows is that
 * the Studio's real socket feeds it, and that `__VAL_AI_TURNS__` holds the
 * turn afterwards. The turn here is a scripted one on the site: it reads the
 * project's code, tries to change it (refused: code is changed in a
 * proposal) and writes content.
 *
 * It also PRINTS the trace and the requests the turn made to Val's API, as
 * a baseline to compare against. Nothing about time is asserted: the model
 * is the mock, which answers at once, so the model's share here is the
 * socket's round trip and nothing else, and the content service is on this
 * machine. Counts are asserted in jest (`codeToolRequests.test.ts`).
 *
 * NOT covered, because no app this suite starts is served as a proposal: a
 * turn in code mode that stages code, the tab evaluating it, and the quick
 * preview after it.
 */
const TAGS = "/content/tags.val.ts";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
  viewport: { width: 1600, height: 1000 },
});

test.beforeEach(async () => {
  await mock.reset();
});

type TraceInPage = {
  end: string | null;
  totalMs: number | null;
  modelMs: number;
  toolMs: number;
  personMs: number;
  modelRoundTrips: number;
  toolCalls: number;
  tools: Record<string, { calls: number; errors: number }>;
  lastWriteMs: number | null;
  replies: { step: number; toolCalls: string[] }[];
  toolRounds: { step: number }[];
};

test("a turn is traced from the socket, and readable from the console", async ({
  page,
}, testInfo) => {
  const requests: { at: number; line: string }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/val/")) return;
    if (url.pathname.startsWith("/api/val/static/")) return;
    requests.push({
      at: Date.now(),
      line: `${request.method()} ${url.pathname.slice("/api/val".length)}`,
    });
  });
  const debugLines: string[] = [];
  const unparsed: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Could not parse AI WebSocket message")) {
      unparsed.push(message.text());
    }
    if (message.text().includes("assistant turn")) {
      debugLines.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("val:debug", "1");
  });
  await openChatStudio(page);
  await mock.aiScript({
    steps: [
      { type: "text", text: "Looking at the code." },
      { type: "tool", name: "list_files" },
      {
        type: "tool",
        name: "search_code",
        arguments: { query: "createFileRoute" },
      },
      { type: "tool", name: "read_file", arguments: { path: "package.json" } },
      {
        type: "tool",
        name: "edit_file",
        arguments: { path: "package.json", old_string: "a", new_string: "b" },
      },
      { type: "tool", name: "get_all_schema" },
      {
        type: "tool",
        name: "create_patch",
        arguments: {
          module_file_path: TAGS,
          patch: [
            { op: "replace", path: ["guides", "label"], value: "Traced" },
          ],
        },
      },
    ],
    response: "Done.",
  });
  const sentAt = Date.now();
  await send(page, "Rename the guides tag");
  const calls = await toolCalls(6);
  await expect(
    page.locator("#val-shadow-root").getByText("Done."),
  ).toBeVisible();

  const read = await page.evaluate(() => {
    const bag: {
      __VAL_AI_TURNS__?: { text(): string; json(): string };
    } = window;
    const turns = bag.__VAL_AI_TURNS__;
    return turns === undefined
      ? null
      : { text: turns.text(), json: turns.json() };
  });
  expect(read, "__VAL_AI_TURNS__ is not on the window").not.toBeNull();
  if (read === null) return;
  const trace: TraceInPage = JSON.parse(read.json);

  expect(trace.end).toBe("response");
  expect(trace.toolCalls).toBe(6);
  // The prompt, then one hand-over per tool result: the mock sends one tool
  // call at a time.
  expect(trace.modelRoundTrips).toBe(7);
  expect(
    Object.fromEntries(
      Object.entries(trace.tools).map(([name, stats]) => [
        name,
        [stats.calls, stats.errors],
      ]),
    ),
  ).toEqual({
    list_files: [1, calls[0].isError ? 1 : 0],
    search_code: [1, calls[1].isError ? 1 : 0],
    read_file: [1, calls[2].isError ? 1 : 0],
    // The site's code is changed in a proposal, never directly.
    edit_file: [1, 1],
    get_all_schema: [1, 0],
    create_patch: [1, 0],
  });
  // Debug is on, so the prompt asked the service for its side of the turn,
  // and what it sent was read rather than dropped as an unknown message.
  expect(trace.replies.map((reply) => reply.toolCalls)).toEqual([
    ["list_files"],
    ["search_code"],
    ["read_file"],
    ["edit_file"],
    ["get_all_schema"],
    ["create_patch"],
  ]);
  expect(trace.toolRounds).toHaveLength(6);
  expect(unparsed).toEqual([]);
  expect(trace.lastWriteMs).toBeNull();
  expect(trace.personMs).toBe(0);
  expect(trace.totalMs).not.toBeNull();
  expect(Math.round(trace.modelMs + trace.toolMs)).toBe(
    Math.round(trace.totalMs ?? 0),
  );
  // And it was printed, since debug is on.
  expect(debugLines.some((line) => line.includes("6 calls"))).toBe(true);

  const duringTurn = requests.filter((each) => each.at >= sentAt);
  const report = [
    "",
    "--- assistant turn trace (scripted, on the site, mock model) ---",
    read.text,
    `--- ${duringTurn.length} requests to /api/val during the turn ---`,
    ...duringTurn.map((each) => `  +${each.at - sentAt}ms ${each.line}`),
    "",
  ].join("\n");
  process.stdout.write(report);
  await testInfo.attach("turn-trace.txt", { body: report });
  await testInfo.attach("turn-trace.json", { body: read.json });
});
