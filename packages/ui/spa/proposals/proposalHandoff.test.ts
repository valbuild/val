import { goToProposal } from "./proposalHandoff";

const address = "https://0123456789abcdef0123--blog.valstart.dev";
const target = `${address}/val/~/content/pages.val.ts?x=1#top`;

function answer(status: number, json: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(json), { status });
}

function run(fetchImpl: typeof fetch) {
  const navigated: string[] = [];
  const posted: { action: string; fields: Record<string, string> }[] = [];
  return goToProposal("0123456789abcdef0123", target, {
    fetchImpl,
    navigate: (href) => navigated.push(href),
    post: (action, fields) => posted.push({ action, fields }),
  }).then(() => ({ navigated, posted }));
}

describe("goToProposal", () => {
  test("posts the handoff to the address, with the page to land on", async () => {
    const { navigated, posted } = await run(
      answer(200, { action: `${address}/__val/handoff`, token: "sealed" }),
    );
    expect(navigated).toEqual([]);
    expect(posted).toEqual([
      {
        action: `${address}/__val/handoff`,
        fields: { token: "sealed", to: "/val/~/content/pages.val.ts?x=1#top" },
      },
    ]);
  });

  test("navigates when this server has no handoff to give", async () => {
    const { navigated, posted } = await run(
      answer(404, { message: "Route not found" }),
    );
    expect(posted).toEqual([]);
    expect(navigated).toEqual([target]);
  });

  test("navigates when the request fails", async () => {
    const { navigated, posted } = await run(async () => {
      throw new TypeError("fetch failed");
    });
    expect(posted).toEqual([]);
    expect(navigated).toEqual([target]);
  });

  test("never posts a handoff to another origin than the target's", async () => {
    const { navigated, posted } = await run(
      answer(200, {
        action: "https://elsewhere.example/__val/handoff",
        token: "x",
      }),
    );
    expect(posted).toEqual([]);
    expect(navigated).toEqual([target]);
  });
});
