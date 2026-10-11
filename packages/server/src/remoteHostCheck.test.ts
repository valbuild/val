import {
  clearHostAnswers,
  fallbackRemoteHost,
  hostServes,
  movedRemoteHost,
  needsHostCheck,
  rewriteRefHost,
  type AskHostProject,
} from "./remoteHostCheck";

const PROJECT = "3f9a2c1";
const REST = `/file/p/${PROJECT}/b/r2/v/0.136.2/h/9c41/f/3fa9c81be402/p/public/val/hero_3fa9c.jpg`;
const ON_DOMAIN = `https://www.acme.no/_val${REST}`;
const ON_FALLBACK = `https://${PROJECT}.valstart.dev/_val${REST}`;

/** A host that answers from a table, and remembers what it was asked. */
const fakeAsk = (answer: Awaited<ReturnType<AskHostProject>>) => {
  const asked: string[] = [];
  const ask: AskHostProject = async (host) => {
    asked.push(host);
    return answer;
  };
  return { ask, asked };
};

describe("remoteHostCheck", () => {
  beforeEach(() => clearHostAnswers());

  test("only a platform ref off the project's own address is asked about", () => {
    expect(needsHostCheck("https://www.acme.no/_val", PROJECT)).toBe(true);
    // The fallback always serves the project's files.
    expect(needsHostCheck(fallbackRemoteHost(PROJECT), PROJECT)).toBe(false);
    // Not a platform host, and not going away.
    expect(needsHostCheck("https://remote.val.build", PROJECT)).toBe(false);
  });

  test("a rewrite changes the host and nothing else", () => {
    expect(rewriteRefHost(ON_DOMAIN, fallbackRemoteHost(PROJECT))).toBe(
      ON_FALLBACK,
    );
    expect(rewriteRefHost("/public/val/a.png", "https://x/_val")).toBeNull();
  });

  test("a host that answers for the project serves it, and is not asked again for a while", async () => {
    const { ask, asked } = fakeAsk({
      status: "answered",
      publicProjectId: PROJECT,
    });
    expect(await hostServes("https://www.acme.no/_val", PROJECT, ask)).toEqual({
      status: "serves",
    });
    await hostServes("https://www.acme.no/_val", PROJECT, ask);
    expect(asked).toEqual(["https://www.acme.no/_val"]);
  });

  test("a host that answers for another project does not serve this one", async () => {
    const { ask } = fakeAsk({ status: "answered", publicProjectId: "aaaaaaa" });
    expect(await hostServes("https://www.acme.no/_val", PROJECT, ask)).toEqual({
      status: "other-project",
      publicProjectId: "aaaaaaa",
    });
  });

  test("a failed answer is asked again next time", async () => {
    const { ask, asked } = fakeAsk({ status: "no-site", httpStatus: 404 });
    await hostServes("https://www.acme.no/_val", PROJECT, ask);
    await hostServes("https://www.acme.no/_val", PROJECT, ask);
    expect(asked).toHaveLength(2);
  });

  test("a ref on a dropped domain moves to the project's own address, and says why", async () => {
    const { ask } = fakeAsk({ status: "no-site", httpStatus: 404 });
    expect(await movedRemoteHost(ON_DOMAIN, ask)).toEqual({
      ref: ON_FALLBACK,
      why: "www.acme.no no longer serves this project, so this file is not shown from there",
      to: `${PROJECT}.valstart.dev`,
    });
  });

  test("a ref that does not need asking is not asked about", async () => {
    const { ask, asked } = fakeAsk({ status: "no-site", httpStatus: 404 });
    expect(await movedRemoteHost(ON_FALLBACK, ask)).toBeUndefined();
    expect(
      await movedRemoteHost(
        `https://remote.val.build${REST.replace("/_val", "")}`,
        ask,
      ),
    ).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
