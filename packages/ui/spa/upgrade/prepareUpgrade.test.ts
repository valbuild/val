import {
  ProposalsApiError,
  type ProposalJson,
  type ProposalPreparation,
} from "../proposals/proposalsClient";
import {
  PREPARATION_MAX_MISSES,
  preparationLine,
  prepareUpgrade,
} from "./prepareUpgrade";

/*
 * Create proposal, until the upgrade page takes over (valbuild/home
 * `docs/plans/upgrades-v2.md`, piece C): made, set up, worked out, its
 * dependencies built -- each said beneath Preparing… -- and then the
 * upgrade's page, at its proposal's address.
 */
const NAME = "0123456789abcdef0123";
const ADDRESS = `https://${NAME}--site.valstart.dev`;

const proposal = (over: Partial<ProposalJson> = {}): ProposalJson => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Minor versions",
  status: "open",
  updatedAt: "2026-10-25T10:00:00.000Z",
  address: null,
  ...over,
});

const at = (
  stage: ProposalPreparation["stage"],
  over: Partial<ProposalPreparation> = {},
): ProposalPreparation => ({ stage, error: null, adept: null, ...over });

function fakeClient(answers: (ProposalPreparation | Error)[]) {
  const created: unknown[] = [];
  const closed: string[] = [];
  const client = {
    create: async (input: unknown) => {
      created.push(input);
      return proposal();
    },
    get: async () => proposal({ address: ADDRESS }),
    close: async (name: string) => {
      closed.push(name);
      return proposal({ status: "closed" });
    },
    preparation: async () => {
      const next = answers.shift();
      if (next === undefined) throw new Error("asked once too often");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, created, closed };
}

const run = (client: ReturnType<typeof fakeClient>["client"]) => {
  const lines: string[] = [];
  return {
    lines,
    done: prepareUpgrade({
      client,
      path: "majors",
      skip: ["react"],
      requestId: "r1",
      onLine: (line) => lines.push(line),
      sleep: async () => {},
    }),
  };
};

describe("Create proposal, until the upgrade page takes over", () => {
  test("made under the press, followed while it is prepared, then its page", async () => {
    const { client, created, closed } = fakeClient([
      at("setup"),
      at("upgrade", {
        adept: {
          step: "Looking up newer versions",
          queued: null,
          phase: null,
          packages: null,
        },
      }),
      at("dependencies", {
        adept: {
          step: "Installing the packages",
          queued: null,
          phase: { index: 1, of: 2 },
          packages: { done: 212, expected: 412 },
        },
      }),
      at("ready"),
    ]);
    const { lines, done } = run(client);
    expect(await done).toEqual({
      status: "ready",
      name: NAME,
      url: `${ADDRESS}/val?val-upgrade=${NAME}`,
    });
    expect(created).toEqual([
      {
        requestId: "r1",
        displayName: "Full upgrade",
        kind: "upgrade",
        upgrade: { path: "majors", skip: ["react"] },
      },
    ]);
    expect(lines).toEqual([
      "Creating the proposal…",
      "Setting up the proposal…",
      "Working out the upgrade · Looking up newer versions",
      "Building the dependencies · Installing the packages (1 of 2) · 212 of 412 packages",
      "Opening the upgrade…",
    ]);
    expect(closed).toEqual([]);
  });

  test("one that could not be prepared is closed, and says why", async () => {
    const { client, closed } = fakeClient([
      at("failed", { error: "The dependencies could not be built: no sharp" }),
    ]);
    expect(await run(client).done).toEqual({
      status: "failed",
      message: "The dependencies could not be built: no sharp",
    });
    expect(closed).toEqual([NAME]);
  });

  test("one that moves nothing is closed again", async () => {
    const { client, closed } = fakeClient([at("nothing")]);
    expect(await run(client).done).toEqual({ status: "nothing" });
    expect(closed).toEqual([NAME]);
  });

  test("a content service without preparations hands it to the upgrade page at once", async () => {
    const { client } = fakeClient([
      new ProposalsApiError(404, "Not found", null),
    ]);
    expect(await run(client).done).toMatchObject({ status: "ready" });
  });

  test("a blip is asked again; Val Build not answering at all is a failure, and the proposal is left to go on", async () => {
    const blip = fakeClient([new Error("fetch failed"), at("ready")]);
    expect(await run(blip.client).done).toMatchObject({ status: "ready" });
    const down = fakeClient(
      Array.from(
        { length: PREPARATION_MAX_MISSES },
        () => new Error("fetch failed"),
      ),
    );
    const prepared = await run(down.client).done;
    expect(prepared).toMatchObject({ status: "failed" });
    expect(down.closed).toEqual([]);
  });
});

describe("what Preparing… says", () => {
  test("adept's queue, when it waits for a builder", () => {
    expect(
      preparationLine(
        at("dependencies", {
          adept: { step: null, queued: 2, phase: null, packages: null },
        }),
      ),
    ).toBe("Building the dependencies · waiting for a builder, 2 ahead");
  });

  test("no detail from adept is the step alone", () => {
    expect(preparationLine(at("dependencies"))).toBe(
      "Building the dependencies…",
    );
  });
});
