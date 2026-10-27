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

describe("step 8: what blocks Publish, and what clears it", () => {
  test("a check names its action, and an action this Studio does not know is none", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          checks: [
            {
              id: "site-code",
              ok: false,
              message: "m",
              action: "update-from-site",
            },
            { id: "later", ok: false, message: "m", action: "something-new" },
          ],
          canMerge: false,
        },
      },
    ]);
    const client = createProposalsClient({ api: "/api/val", fetchImpl });
    const { checks } = await client.mergeChecks(NAME);
    expect(checks.map((check) => check.action)).toEqual([
      "update-from-site",
      undefined,
    ]);
  });

  test("Update from the site is a POST on the proposal, answered as the proposal", async () => {
    const { sent, fetchImpl } = fakeFetch([
      { status: 200, body: { proposal: json() } },
    ]);
    const client = createProposalsClient({ api: "/api/val", fetchImpl });
    const updated = await client.updateFromSite(NAME);
    expect(sent).toEqual([
      {
        url: `/api/val/proposals-api/${NAME}/update-from-site`,
        method: "POST",
        body: {},
      },
    ]);
    expect(updated.name).toBe(NAME);
  });
});

/*
 * valbuild/home `docs/adept.md`, step 6: a proposal whose dependencies changed
 * without a lockfile to match waits for one, and Compute lockfile asks for it.
 */
describe("a proposal's dependencies", () => {
  test("are read with the proposal, and a state this Studio does not know is the site's", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          proposal: {
            ...json(),
            dependencies: { state: "lockfile", computing: false, error: null },
          },
        },
      },
      {
        status: 200,
        body: { proposal: { ...json(), dependencies: { state: "later" } } },
      },
    ]);
    const client = createProposalsClient({ api: "/api/val", fetchImpl });
    expect((await client.get(NAME)).dependencies).toEqual({
      state: "lockfile",
      computing: false,
      error: null,
    });
    expect((await client.get(NAME)).dependencies).toEqual({ state: "site" });
  });

  test("Compute lockfile is a POST on the proposal, answered with what it builds on", async () => {
    const { sent, fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          dependencies: { state: "lockfile", computing: true, error: null },
        },
      },
    ]);
    const client = createProposalsClient({ api: "/api/val", fetchImpl });
    expect(await client.computeLockfile(NAME)).toEqual({
      state: "lockfile",
      computing: true,
      error: null,
    });
    expect(sent).toEqual([
      {
        url: `/api/val/proposals-api/${NAME}/lockfile`,
        method: "POST",
        body: {},
      },
    ]);
  });
});

/*
 * valbuild/home `docs/adept.md`, step 7: an upgrade is a proposal of its own
 * kind, followed to Publish by what content says of it and the typecheck this
 * Studio reports.
 */
describe("an upgrade proposal", () => {
  test("is created with its kind and what to upgrade", async () => {
    const { sent, fetchImpl } = fakeFetch([
      { status: 200, body: { proposal: json() } },
    ]);
    await createProposalsClient({ api: "/api/val", fetchImpl }).create({
      requestId: "r1",
      displayName: "Upgrade to new major versions",
      kind: "upgrade",
      upgrade: { path: "majors", skip: ["react"] },
    });
    expect(sent).toEqual([
      {
        url: "/api/val/proposals-api",
        method: "POST",
        body: {
          requestId: "r1",
          displayName: "Upgrade to new major versions",
          kind: "upgrade",
          upgrade: { path: "majors", skip: ["react"] },
        },
      },
    ]);
  });

  test("reads its upgrade and its typecheck, and a change of an unknown kind as none", async () => {
    const typecheck = {
      inputs: "i1",
      newErrors: 1,
      errors: [
        { file: "src/a.ts", line: 3, column: 7, code: 2322, message: "Nope" },
      ],
      checkedAt: "2026-10-21T10:00:00.000Z",
    };
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          proposal: {
            ...json(),
            kind: "upgrade",
            upgrade: {
              path: "cves",
              state: "staged",
              changes: [
                { name: "zod", from: "3.0.0", to: "3.1.0", kind: "minor" },
                { name: "x", from: "1", to: "2", kind: "sideways" },
              ],
              vulnerableBefore: 2,
              vulnerableAfter: 0,
              error: null,
            },
            typecheck,
          },
        },
      },
    ]);
    const read = await createProposalsClient({ api: "", fetchImpl }).get(NAME);
    expect(read.kind).toBe("upgrade");
    expect(read.upgrade?.changes).toEqual([
      { name: "zod", from: "3.0.0", to: "3.1.0", kind: "minor" },
      { name: "x", from: "1", to: "2", kind: null },
    ]);
    expect(read.typecheck).toEqual(typecheck);
  });

  test("its typecheck is reported for the inputs it checked", async () => {
    const answer = {
      inputs: "i1",
      newErrors: 0,
      errors: [],
      checkedAt: "2026-10-21T10:00:00.000Z",
    };
    const { sent, fetchImpl } = fakeFetch([
      { status: 200, body: { typecheck: answer } },
    ]);
    const reported = await createProposalsClient({
      api: "/api/val",
      fetchImpl,
    }).reportTypecheck(NAME, { inputs: "i1", newErrors: [] });
    expect(reported).toEqual(answer);
    expect(sent).toEqual([
      {
        url: `/api/val/proposals-api/${NAME}/typecheck`,
        method: "POST",
        body: { inputs: "i1", newErrors: [] },
      },
    ]);
  });

  test("a merge check's actions are the ones this Studio knows; any other is none", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          canMerge: false,
          checks: [
            {
              id: "dependencies",
              ok: false,
              message: "m",
              action: "compute-lockfile",
            },
            { id: "types", ok: false, message: "m", action: "typecheck" },
            { id: "later", ok: false, message: "m", action: "fly" },
          ],
        },
      },
    ]);
    const { checks } = await createProposalsClient({
      api: "",
      fetchImpl,
    }).mergeChecks(NAME);
    expect(checks.map((check) => check.action)).toEqual([
      "compute-lockfile",
      "typecheck",
      undefined,
    ]);
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

  test("is the viewer's own when they are one of its owners: changes moved in together are everyone's", () => {
    const moved = json({ ownerId: "kari", ownerIds: ["kari", "ada"] });
    expect(toSummary(moved, "ada", () => null).ownedByViewer).toBe(true);
    expect(toSummary(moved, "bo", () => null).ownedByViewer).toBe(false);
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
