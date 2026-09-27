import {
  layerMoved,
  loadedLayer,
  markStudioOutOfDate,
  readLiveLayer,
  rememberLoadedLayer,
  resetLoadedLayerForTests,
  siteMovedSinceLoad,
  studioOutOfDateRefusals,
  subscribeStudioOutOfDate,
} from "./loadedLayer";

/**
 * Whether a Studio is out of date: the one question the reload prompt hangs
 * on, and the rule that matters most is the one that does NOT block --
 * anything that cannot tell must publish as before, or a loader hiccup would
 * stop every editor on every site.
 */

const head =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

/** A fetch that answers each call with the next body. */
function heads(...bodies: unknown[]): typeof fetch {
  let i = 0;
  return async () =>
    new Response(JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]), {
      status: 200,
    });
}

beforeEach(() => resetLoadedLayerForTests());

describe("reading the live build's layer", () => {
  test("names the layer", async () => {
    await expect(
      readLiveLayer(head({ hash: "h", projectVendorRev: "layer-1" })),
    ).resolves.toBe("layer-1");
  });

  test("a head that names no layer cannot tell, so it never blocks", async () => {
    await expect(readLiveLayer(head({ hash: "h" }))).resolves.toBe(undefined);
  });

  test("anything else cannot tell", async () => {
    await expect(readLiveLayer(head({ published: false }))).resolves.toBe(
      undefined,
    );
    await expect(readLiveLayer(head({}, 404))).resolves.toBe(undefined);
    const offline: typeof fetch = async () => {
      throw new Error("offline");
    };
    await expect(readLiveLayer(offline)).resolves.toBe(undefined);
  });
});

describe("has the site moved", () => {
  test("only when both readings answer and differ", () => {
    expect(layerMoved("a", "b")).toBe(true);
    expect(layerMoved("a", "a")).toBe(false);
    expect(layerMoved(null, "a")).toBe(true);
    expect(layerMoved(undefined, "b")).toBe(false);
    expect(layerMoved("a", undefined)).toBe(false);
  });

  test("against what the page loaded on, not what it reads later", async () => {
    const fetchImpl = heads(
      { hash: "h1", projectVendorRev: "old" },
      { hash: "h2", projectVendorRev: "new" },
    );
    rememberLoadedLayer(fetchImpl);
    // A second remember must not move the baseline onto the new layer.
    rememberLoadedLayer(fetchImpl);
    await expect(loadedLayer()).resolves.toBe("old");
    await expect(siteMovedSinceLoad(fetchImpl)).resolves.toBe(true);
  });

  test("a page that never took a reading is never stale", async () => {
    await expect(
      siteMovedSinceLoad(head({ hash: "h", projectVendorRev: "new" })),
    ).resolves.toBe(false);
  });
});

test("every refusal is counted, so a dismissed prompt comes back", () => {
  const heard: number[] = [];
  subscribeStudioOutOfDate(() => heard.push(studioOutOfDateRefusals()));
  markStudioOutOfDate();
  markStudioOutOfDate();
  expect(heard).toEqual([1, 2]);
});
