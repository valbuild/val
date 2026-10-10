import {
  ProposalsApiError,
  createProposalsClient,
  meansNoProposals,
  sameStudioPageAt,
  toSummary,
  type ProposalJson,
} from "./proposalsClient";

const NAME = "0123456789abcdef0123";
const json = (over: Partial<ProposalJson> = {}): ProposalJson => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Spring campaign",
  description: "",
  ownerId: "ada",
  status: "open",
  updatedAt: "2026-10-07T10:00:00.000Z",
  closedBy: null,
  address: `https://${NAME}.valstart.dev`,
  changes: 3,
  ...over,
});

function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const sent: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
    });
  };
  return { sent, fetchImpl };
}

describe("the proposals client", () => {
  test("speaks to this deployment's proxy, by content's paths", async () => {
    const { sent, fetchImpl } = fakeFetch([
      { status: 200, body: { proposals: [json()], siteUrl: "https://site" } },
      { status: 200, body: { proposal: json() } },
      { status: 200, body: { proposal: json() } },
      { status: 200, body: { proposal: json() } },
      { status: 200, body: { proposal: json() } },
      { status: 200, body: { proposal: json() } },
      { status: 200, body: { proposal: json() } },
    ]);
    const client = createProposalsClient({ api: "/api/val/", fetchImpl });
    const listed = await client.list();
    expect(listed.siteUrl).toBe("https://site");
    expect(listed.proposals[0]!.changes).toBe(3);
    await client.get(NAME);
    await client.create({ displayName: "Spring", requestId: "press-1" });
    await client.rename(NAME, "Summer");
    await client.close(NAME);
    await client.reopen(NAME);
    await client.retrySetup(NAME);
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET /api/val/proposals-api",
      `GET /api/val/proposals-api/${NAME}`,
      "POST /api/val/proposals-api",
      `PATCH /api/val/proposals-api/${NAME}`,
      `POST /api/val/proposals-api/${NAME}/close`,
      `POST /api/val/proposals-api/${NAME}/reopen`,
      `POST /api/val/proposals-api/${NAME}/setup/retry`,
    ]);
    expect(sent[2]!.body).toEqual({
      displayName: "Spring",
      requestId: "press-1",
    });
    expect(sent[3]!.body).toEqual({ displayName: "Summer" });
  });

  test("reads a content service older than the fields it adds", async () => {
    const { address: _address, changes: _changes, ...older } = json();
    const { fetchImpl } = fakeFetch([
      { status: 200, body: { proposals: [older] } },
    ]);
    const listed = await createProposalsClient({ api: "", fetchImpl }).list();
    expect(listed.siteUrl).toBeNull();
    expect(listed.proposals[0]!.address).toBeUndefined();
    expect(toSummary(listed.proposals[0]!, null, () => null).changes).toBe(0);
  });

  test("a proposal that exists already is named, so it can be opened", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 409,
        body: {
          message: "Conflict: this proposal already exists",
          details: { proposal: json({ displayName: "The first" }) },
        },
      },
    ]);
    const error = await createProposalsClient({ api: "", fetchImpl })
      .create({ displayName: "Again", requestId: "press-2" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ProposalsApiError);
    if (!(error instanceof ProposalsApiError)) return;
    expect(error.message).toBe("Conflict: this proposal already exists");
    expect(error.existing()?.displayName).toBe("The first");
  });

  test("off and absent are not failures; anything else is", () => {
    expect(meansNoProposals(new ProposalsApiError(404, "Not found", {}))).toBe(
      true,
    );
    expect(meansNoProposals(new ProposalsApiError(501, "No content", {}))).toBe(
      true,
    );
    expect(meansNoProposals(new ProposalsApiError(500, "Down", {}))).toBe(
      false,
    );
    expect(meansNoProposals(new ProposalsApiError(401, "Sign in", {}))).toBe(
      false,
    );
    expect(meansNoProposals(new Error("network"))).toBe(false);
  });
});

describe("a proposal as the screens show it", () => {
  test("says You to its owner, and names everyone else", () => {
    const ada = { name: "Ada" };
    expect(toSummary(json(), "ada", () => ada)).toMatchObject({
      ownedByViewer: true,
      owner: ada,
      description: null,
      changes: 3,
    });
    expect(toSummary(json(), "kari", () => ada).ownedByViewer).toBe(false);
  });

  test("is open while it is updating, resolving or merging", () => {
    for (const status of ["updating", "needs-resolution", "merging"] as const) {
      expect(toSummary(json({ status }), null, () => null).status).toBe("open");
    }
    expect(
      toSummary(json({ status: "closed", closedBy: "kari" }), null, (id) => ({
        name: id,
      })),
    ).toMatchObject({ status: "closed", closedBy: { name: "kari" } });
  });

  test("a failed setup carries its reason", () => {
    expect(
      toSummary(
        json({ setup: { status: "failed", lastError: "no build" } }),
        null,
        () => null,
      ).setup,
    ).toEqual({ status: "failed", error: "no build" });
  });
});

test("going somewhere keeps the Studio page you are on", () => {
  const here = new URL("https://site.example/val/~/app/page.val.ts?p=1#field");
  expect(sameStudioPageAt(`https://${NAME}.valstart.dev`, here)).toBe(
    `https://${NAME}.valstart.dev/val/~/app/page.val.ts?p=1#field`,
  );
});
