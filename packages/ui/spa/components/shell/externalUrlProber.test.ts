import {
  createBatchedProber,
  isRetryable,
  ProbeBatch,
} from "./externalUrlProber";
import { ExternalUrlProbeResult } from "./externalUrlReachability";

const answered = (code: number): ExternalUrlProbeResult => ({
  kind: "answered",
  code,
  finalUrl: "",
  ms: 1,
});

/** Records every batch it was given, and answers from a script. */
function scriptedBatch(
  answer: (url: string, attempt: number) => ExternalUrlProbeResult,
) {
  const batches: string[][] = [];
  const attemptsByUrl = new Map<string, number>();
  const probeBatch: ProbeBatch = async (urls) => {
    batches.push([...urls]);
    const results = new Map<string, ExternalUrlProbeResult>();
    for (const url of urls) {
      const attempt = (attemptsByUrl.get(url) ?? 0) + 1;
      attemptsByUrl.set(url, attempt);
      results.set(url, answer(url, attempt));
    }
    return results;
  };
  return { probeBatch, batches, attemptsByUrl };
}

/** Collects what the prober reported, in order. */
function collector() {
  const reported: { url: string; result: ExternalUrlProbeResult }[] = [];
  return {
    reported,
    onResult: (url: string, result: ExternalUrlProbeResult) =>
      reported.push({ url, result }),
  };
}

const noSleep = async () => undefined;

const urls = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://example.com/${i}`);

describe("batching", () => {
  test("goes in batches rather than opening everything at once", async () => {
    const { probeBatch, batches } = scriptedBatch(() => answered(200));
    const probe = createBatchedProber(probeBatch, {
      batchSize: 10,
      sleep: noSleep,
    });
    const { reported, onResult } = collector();

    await probe(urls(1000), onResult, new AbortController().signal);

    expect(batches).toHaveLength(100);
    expect(batches.every((batch) => batch.length === 10)).toBe(true);
    expect(reported).toHaveLength(1000);
  });

  test("the last batch is whatever is left", async () => {
    const { probeBatch, batches } = scriptedBatch(() => answered(200));
    const probe = createBatchedProber(probeBatch, {
      batchSize: 4,
      sleep: noSleep,
    });
    await probe(urls(10), collector().onResult, new AbortController().signal);
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 2]);
  });

  test("the same URL twice is one request", async () => {
    const { probeBatch, batches } = scriptedBatch(() => answered(200));
    const probe = createBatchedProber(probeBatch, { sleep: noSleep });
    const { reported, onResult } = collector();
    await probe(
      ["https://a.com", "https://a.com"],
      onResult,
      new AbortController().signal,
    );
    expect(batches).toEqual([["https://a.com"]]);
    expect(reported).toHaveLength(1);
  });

  test("reports each URL exactly once", async () => {
    const { probeBatch } = scriptedBatch((_, attempt) =>
      attempt < 2 ? answered(503) : answered(200),
    );
    const probe = createBatchedProber(probeBatch, {
      batchSize: 3,
      sleep: noSleep,
    });
    const { reported, onResult } = collector();
    await probe(urls(7), onResult, new AbortController().signal);
    expect(reported).toHaveLength(7);
    expect(new Set(reported.map((r) => r.url)).size).toBe(7);
  });
});

describe("retrying", () => {
  test("retries a 503 and reports the answer it eventually gets", async () => {
    const { probeBatch, attemptsByUrl } = scriptedBatch((_, attempt) =>
      attempt < 3 ? answered(503) : answered(200),
    );
    const probe = createBatchedProber(probeBatch, {
      attempts: 3,
      sleep: noSleep,
    });
    const { reported, onResult } = collector();

    await probe(["https://a.com"], onResult, new AbortController().signal);

    expect(attemptsByUrl.get("https://a.com")).toBe(3);
    expect(reported).toEqual([{ url: "https://a.com", result: answered(200) }]);
  });

  test("gives up after the third attempt and reports the failure", async () => {
    const { probeBatch, attemptsByUrl } = scriptedBatch(() => answered(503));
    const probe = createBatchedProber(probeBatch, {
      attempts: 3,
      sleep: noSleep,
    });
    const { reported, onResult } = collector();

    await probe(["https://a.com"], onResult, new AbortController().signal);

    expect(attemptsByUrl.get("https://a.com")).toBe(3);
    expect(reported[0].result).toEqual(answered(503));
  });

  test("does not retry an answer", async () => {
    // A 404 three times is three 404s, more slowly - and on a site with four
    // hundred dead links it is three times the traffic to say the same thing.
    const { probeBatch, attemptsByUrl } = scriptedBatch(() => answered(404));
    const probe = createBatchedProber(probeBatch, { sleep: noSleep });
    const { reported, onResult } = collector();

    await probe(["https://a.com"], onResult, new AbortController().signal);

    expect(attemptsByUrl.get("https://a.com")).toBe(1);
    expect(reported[0].result).toEqual(answered(404));
  });

  test("retries only the URLs that need it", async () => {
    const { probeBatch, batches } = scriptedBatch((url) =>
      url.endsWith("/1") ? answered(500) : answered(200),
    );
    const probe = createBatchedProber(probeBatch, {
      batchSize: 10,
      attempts: 3,
      sleep: noSleep,
    });
    await probe(urls(3), collector().onResult, new AbortController().signal);

    expect(batches).toEqual([
      [
        "https://example.com/0",
        "https://example.com/1",
        "https://example.com/2",
      ],
      ["https://example.com/1"],
      ["https://example.com/1"],
    ]);
  });

  test("backs off further each time", async () => {
    const waits: number[] = [];
    const { probeBatch } = scriptedBatch(() => answered(503));
    const probe = createBatchedProber(probeBatch, {
      attempts: 4,
      backoffMs: 500,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await probe(
      ["https://a.com"],
      collector().onResult,
      new AbortController().signal,
    );
    expect(waits).toEqual([500, 1000, 2000]);
  });

  test("a batch that throws is a retryable failure of every URL in it", async () => {
    let calls = 0;
    const probeBatch: ProbeBatch = async (batch) => {
      calls++;
      if (calls === 1) throw new Error("socket hang up");
      return new Map(batch.map((url) => [url, answered(200)]));
    };
    const probe = createBatchedProber(probeBatch, { sleep: noSleep });
    const { reported, onResult } = collector();

    await probe(
      ["https://a.com", "https://b.com"],
      onResult,
      new AbortController().signal,
    );

    expect(calls).toBe(2);
    expect(reported.map((r) => r.result)).toEqual([
      answered(200),
      answered(200),
    ]);
  });

  test("a URL the batch forgot is reported rather than lost", async () => {
    const probeBatch: ProbeBatch = async () => new Map();
    const probe = createBatchedProber(probeBatch, {
      attempts: 2,
      sleep: noSleep,
    });
    const { reported, onResult } = collector();

    await probe(["https://a.com"], onResult, new AbortController().signal);

    expect(reported).toHaveLength(1);
    expect(reported[0].result.kind).toBe("unreachable");
  });
});

describe("stopping", () => {
  test("stops between batches", async () => {
    const controller = new AbortController();
    const { probeBatch, batches } = scriptedBatch(() => {
      controller.abort();
      return answered(200);
    });
    const probe = createBatchedProber(probeBatch, {
      batchSize: 2,
      sleep: noSleep,
    });
    const { reported, onResult } = collector();

    await probe(urls(10), onResult, controller.signal);

    // The first batch runs; nothing after it, and nothing from it is
    // reported - so those rows stay unchecked rather than looking answered.
    expect(batches).toHaveLength(1);
    expect(reported).toHaveLength(0);
  });

  test("an already-aborted signal does nothing at all", async () => {
    const controller = new AbortController();
    controller.abort();
    const { probeBatch, batches } = scriptedBatch(() => answered(200));
    const probe = createBatchedProber(probeBatch, { sleep: noSleep });
    await probe(urls(5), collector().onResult, controller.signal);
    expect(batches).toEqual([]);
  });
});

describe("isRetryable", () => {
  test.each([
    [answered(200), false],
    [answered(301), false],
    [answered(403), false],
    [answered(404), false],
    [answered(410), false],
    [answered(429), true],
    [answered(500), true],
    [answered(503), true],
  ])("%o -> %s", (result, expected) => {
    expect(isRetryable(result)).toBe(expected);
  });

  test("a timeout and an unreachable host are worth asking again", () => {
    expect(isRetryable({ kind: "timeout", ms: 5000 })).toBe(true);
    expect(isRetryable({ kind: "unreachable", message: "dns" })).toBe(true);
  });

  test("a URL that was never opened is not", () => {
    expect(isRetryable({ kind: "skipped", message: "not a URL" })).toBe(false);
  });
});
