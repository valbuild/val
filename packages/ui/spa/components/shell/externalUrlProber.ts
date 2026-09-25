import {
  ExternalUrlProbeResult,
  ExternalUrlProber,
} from "./externalUrlReachability";

/**
 * Opens one batch of URLs. The part that talks to the app's server.
 *
 * Whatever it does not return a result for is treated as unreachable, and a
 * throw fails the whole batch - both retryable, both eventually reported, so a
 * prober can be written without thinking about either. Throw a
 * {@link ProbeUnavailableError} for the other kind of failure: the one that is
 * the CHECKER's and will answer the same way next time.
 */
export type ProbeBatch = (
  urls: readonly string[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<string, ExternalUrlProbeResult>>;

export type BatchedProberOptions = {
  /**
   * URLs per request. Ten is enough to keep the round trips down and few
   * enough that the server is never asked to hold a thousand sockets open
   * because somebody pressed Check on a big site.
   */
  batchSize?: number;
  /** Attempts per URL, the first one included. */
  attempts?: number;
  /** The first wait before a retry. Doubles each time. */
  backoffMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/**
 * The link check itself could not run, and asking again will not help.
 *
 * A session that expired answers 401 to every batch, and the endpoint answers
 * 400 to a request it will keep refusing. Treating those like a dropped
 * connection retried each URL three times and then reported every one of them
 * as unreachable - which reads as a site full of dead links, when what
 * happened is that nothing was checked at all. So this is reported as SKIPPED,
 * in the same shape a `mailto:` is: not attempted, and here is why.
 */
export class ProbeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeUnavailableError";
  }
}

export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = 500;

/**
 * Whether a result is worth asking again.
 *
 * The distinction is between an ANSWER and a failure to get one. A 404 is an
 * answer — asking three times gets three 404s, more slowly — and so is a 403.
 * A timeout, a refused connection, a 5xx or a 429 are the site or the network
 * being momentarily unable to answer, which is exactly what a retry is for.
 *
 * Getting this wrong in the generous direction is not harmless: retrying every
 * 404 on a site with four hundred dead links triples the time and the traffic
 * to reach the same report.
 */
export function isRetryable(result: ExternalUrlProbeResult): boolean {
  switch (result.kind) {
    case "unreachable":
    case "timeout":
      return true;
    case "answered":
      return result.code === 429 || result.code >= 500;
    case "skipped":
      return false;
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * A prober that goes in batches and retries what is worth retrying.
 *
 * Batches run one after another rather than all at once. A project with a
 * thousand external URLs is not unusual for a site that has been edited for
 * years, and "check them all" must not turn into a thousand simultaneous
 * outbound requests from the app's server — which is a denial of service
 * against the app, and looks like one to whichever site is on the other end.
 *
 * Each URL is reported exactly once, as soon as its result is final, so the
 * report fills in while the rest of the batches are still running. Aborting
 * stops between attempts and between batches; URLs that were never reached are
 * simply never reported, which is what leaves their rows unchecked rather than
 * failed.
 */
export function createBatchedProber(
  probeBatch: ProbeBatch,
  options: BatchedProberOptions = {},
): ExternalUrlProber {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;

  return async (urls, onResult, signal) => {
    // The same URL twice in one batch is one request; the record cannot hold
    // duplicate keys, but a caller can pass a list that does.
    const unique = [...new Set(urls)];
    for (let start = 0; start < unique.length; start += batchSize) {
      if (signal.aborted) return;
      let pending = unique.slice(start, start + batchSize);
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (signal.aborted) return;
        if (attempt > 1) {
          await sleep(backoffMs * 2 ** (attempt - 2), signal);
          if (signal.aborted) return;
        }
        const results = await runBatch(probeBatch, pending, signal);
        if (signal.aborted) return;
        const retry: string[] = [];
        for (const url of pending) {
          const result = results.get(url) ?? missing();
          // Report on the last attempt whatever we have — a URL that has
          // failed three times is a finding, not an absence.
          if (attempt === attempts || !isRetryable(result)) {
            onResult(url, result);
          } else {
            retry.push(url);
          }
        }
        if (retry.length === 0) break;
        pending = retry;
      }
    }
  };
}

/**
 * A batch that throws is a batch where every URL failed.
 *
 * Retryably so, and reported as unreachable - unless the throw says the check
 * itself is unavailable, which is neither the link's fault nor worth asking
 * again. `skipped` is not retryable (see `isRetryable`), so that distinction
 * is the whole of what stops the retries too.
 */
async function runBatch(
  probeBatch: ProbeBatch,
  urls: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, ExternalUrlProbeResult>> {
  try {
    return await probeBatch(urls, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: ExternalUrlProbeResult =
      error instanceof ProbeUnavailableError
        ? { kind: "skipped", message: `Not checked: ${message}.` }
        : { kind: "unreachable", message };
    return new Map(urls.map((url) => [url, result]));
  }
}

function missing(): ExternalUrlProbeResult {
  return { kind: "unreachable", message: "the check did not report a result" };
}
