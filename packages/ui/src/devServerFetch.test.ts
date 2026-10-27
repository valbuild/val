import {
  DEV_SERVER_ATTEMPTS,
  DEV_SERVER_RETRY_DELAY_MS,
  devServerFetch,
} from "./devServerFetch";

/**
 * The clock is faked by injection rather than by `jest.useFakeTimers()`: the
 * waits are the thing being asserted, and a test that has to advance timers to
 * let the code proceed cannot also cheaply assert what the waits were.
 */
function recordingSleep() {
  const waited: number[] = [];
  return {
    waited,
    sleep: (ms: number) => {
      waited.push(ms);
      return Promise.resolve();
    },
  };
}

const HEADERS = { Accept: "text/javascript" };
const URL = "http://localhost:5173/api/val/static/spa/main.jsx";

function response(status: number): Response {
  // Only `status` is read by these tests; the body is irrelevant.
  return new Response(null, { status });
}

describe("devServerFetch", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // The failure path logs by design; keep it out of the test output.
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test("returns the first response and does not retry", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200));
    const { sleep, waited } = recordingSleep();

    const res = await devServerFetch(URL, HEADERS, { fetchImpl, sleep });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(URL, { headers: HEADERS });
    expect(waited).toEqual([]);
  });

  test("retries a thrown connection error and returns the response that follows", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new TypeError("fetch failed"), { code: "ETIMEDOUT" }),
      )
      .mockResolvedValue(response(200));
    const { sleep, waited } = recordingSleep();

    const res = await devServerFetch(URL, HEADERS, { fetchImpl, sleep });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waited).toEqual([DEV_SERVER_RETRY_DELAY_MS]);
    // The recovered case is not a problem anybody needs to read about.
    expect(consoleError).not.toHaveBeenCalled();
  });

  /**
   * The property the e2e flake actually needed. A single dropped connection
   * used to take out whichever spec was mid-`openStudio`.
   */
  test("survives every attempt but the last", async () => {
    const fetchImpl = jest.fn();
    for (let i = 0; i < DEV_SERVER_ATTEMPTS - 1; i++) {
      fetchImpl.mockRejectedValueOnce(new TypeError("fetch failed"));
    }
    fetchImpl.mockResolvedValue(response(200));
    const { sleep, waited } = recordingSleep();

    const res = await devServerFetch(URL, HEADERS, { fetchImpl, sleep });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(DEV_SERVER_ATTEMPTS);
    // Backoff grows with the attempt number rather than staying flat.
    expect(waited).toEqual([250, 500, 750]);
  });

  test("gives up after the last attempt, throwing the underlying error", async () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      code: "ETIMEDOUT",
    });
    const fetchImpl = jest.fn().mockRejectedValue(err);
    const { sleep } = recordingSleep();

    await expect(
      devServerFetch(URL, HEADERS, { fetchImpl, sleep }),
    ).rejects.toBe(err);

    expect(fetchImpl).toHaveBeenCalledTimes(DEV_SERVER_ATTEMPTS);
    // Naming the URL is the point: the old message did not.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toContain(URL);
  });

  /**
   * A bad status is an answer, and repeating the request would turn a build
   * error into a slow build error.
   */
  test("does not retry a response, however bad its status", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(500));
    const { sleep, waited } = recordingSleep();

    const res = await devServerFetch(URL, HEADERS, { fetchImpl, sleep });

    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
