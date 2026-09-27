import { waitUntilServed } from "./fetchPublicFile";

/** A `/__api/head` that answers these hashes in turn, then keeps the last. */
function headsServing(...hashes: string[]) {
  let i = 0;
  const fetchImpl: typeof fetch = async () => {
    const hash = hashes[Math.min(i++, hashes.length - 1)];
    return new Response(JSON.stringify({ hash }), { status: 200 });
  };
  return fetchImpl;
}

const noSleep = async () => undefined;

describe("waiting for the site to serve a build", () => {
  test("resolves true once the head names it", async () => {
    expect(
      await waitUntilServed("new", {
        fetchImpl: headsServing("old", "old", "new"),
        sleep: noSleep,
      }),
    ).toBe(true);
  });

  test("gives up, rather than waiting forever", async () => {
    expect(
      await waitUntilServed("new", {
        fetchImpl: headsServing("old"),
        sleep: noSleep,
        timeoutMs: 0,
      }),
    ).toBe(false);
  });

  test("a site with no head route cannot tell", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("", { status: 404 });
    expect(await waitUntilServed("new", { fetchImpl, sleep: noSleep })).toBe(
      undefined,
    );
  });
});
