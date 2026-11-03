import { createProjectSourceReader } from "./publishClient";

/**
 * The site's source by version (`createProjectSourceReader`): what the
 * Studio's code tools read on every call. The scenario
 * (`scenarios/src/projectSource.scenario.test.ts`) drives it through the app
 * and the mock content host; these pin what it sends and what it keeps.
 */

type Sent = { url: string; ifNoneMatch: string | null };

function contentAnswering(
  answers: Array<{ status: number; etag?: string; files?: unknown }>,
) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(url), ifNoneMatch: headers.get("if-none-match") });
    const answer = answers[sent.length - 1];
    if (answer === undefined) throw new Error("asked once too often");
    return new Response(
      answer.status === 304
        ? null
        : JSON.stringify({
            files: answer.files ?? null,
            publicFiles: null,
            publicPaths: null,
          }),
      {
        status: answer.status,
        headers: answer.etag !== undefined ? { etag: answer.etag } : {},
      },
    );
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

test("asks with the tag it holds, and keeps the answer while content says nothing moved", async () => {
  const { sent, fetchImpl } = contentAnswering([
    { status: 200, etag: '"v1"', files: { "a.ts": "1" } },
    { status: 304, etag: '"v1"' },
    { status: 200, etag: '"v2"', files: { "a.ts": "2" } },
  ]);
  const read = createProjectSourceReader({ api: "/api/val", fetchImpl });
  expect(await read()).toEqual({ "a.ts": "1" });
  expect(await read()).toEqual({ "a.ts": "1" });
  expect(await read()).toEqual({ "a.ts": "2" });
  expect(sent).toEqual([
    { url: "/api/val/publish-api/project-source", ifNoneMatch: null },
    { url: "/api/val/publish-api/project-source", ifNoneMatch: '"v1"' },
    { url: "/api/val/publish-api/project-source", ifNoneMatch: '"v1"' },
  ]);
});

test("an answer without a tag -- an older content service -- is read whole every time", async () => {
  const { sent, fetchImpl } = contentAnswering([
    { status: 200, files: { "a.ts": "1" } },
    { status: 200, files: { "a.ts": "1" } },
  ]);
  const read = createProjectSourceReader({ api: "/api/val", fetchImpl });
  await read();
  await read();
  expect(sent.map((s) => s.ifNoneMatch)).toEqual([null, null]);
});

test("a refusal is thrown as the publish client throws one", async () => {
  const { fetchImpl } = contentAnswering([{ status: 502 }]);
  const read = createProjectSourceReader({ api: "/api/val", fetchImpl });
  await expect(read()).rejects.toMatchObject({ statusCode: 502 });
});
