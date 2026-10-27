import { fetchMediaBytes } from "./fetchMediaBytes";

/**
 * A response whose headers arrived and whose body did not.
 *
 * `fetch` resolves on the headers, so the failure surfaces at `blob()`. It has
 * to come back as an error result: a rejection left the rename input busy
 * forever.
 */
function cutOffResponse(contentType: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("network error"));
      },
    }),
    { status: 200, headers: { "content-type": contentType } },
  );
}

describe("fetchMediaBytes", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test("a body cut off after the headers is an error, not a rejection", async () => {
    global.fetch = jest.fn(() => Promise.resolve(cutOffResponse("image/png")));
    await expect(
      fetchMediaBytes("/val/a.png", "a.png", "image/png"),
    ).resolves.toEqual({ status: "error", message: "Could not read a.png." });
  });

  test("a web page answered for a file is an error", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(cutOffResponse("text/html; charset=utf-8")),
    );
    const res = await fetchMediaBytes("/val/a.png", "a.png", "image/png");
    expect(res.status).toBe("error");
  });
});
