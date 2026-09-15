import { useMemo } from "react";
import { useClient } from "../ValProvider";
import { createBatchedProber, ProbeBatch } from "./externalUrlProber";
import {
  ExternalUrlProber,
  ExternalUrlProbeResult,
} from "./externalUrlReachability";

/**
 * How many URLs go to the server in one request.
 *
 * Ten, and the route refuses more than twenty - so this is the number that has
 * to change if the cap does, not a coincidence that currently holds. Each URL
 * in a batch is an outbound connection the server opens in parallel, and the
 * batches themselves run one after another: see `createBatchedProber`.
 */
const BATCH_SIZE = 10;

/**
 * Opens external URLs through the app's own server.
 *
 * It cannot be done from here. A cross-origin `fetch` cannot read a response
 * status without CORS headers no ordinary site sends, and `no-cors` answers
 * opaquely for everything - so the check is a request the server makes, and
 * this is the thin thing that asks it to.
 *
 * Everything difficult is on one side or the other of this hook and not in it:
 * batching, retries and cancellation are `createBatchedProber`, and the SSRF
 * guard is the server's.
 */
export function useExternalUrlProber(): ExternalUrlProber {
  const client = useClient();
  return useMemo(() => {
    const probeBatch: ProbeBatch = async (urls, signal) => {
      const res = await client("/external-urls/check", "POST", {
        body: { urls: [...urls] },
      });
      const results = new Map<string, ExternalUrlProbeResult>();
      if (signal.aborted) {
        return results;
      }
      if (res.status !== 200) {
        // Thrown rather than returned empty, because `createBatchedProber`
        // treats a throw as a retryable failure of the whole batch - which is
        // what a 500 or a dropped connection is.
        throw new Error(
          res.status === null
            ? "the link check could not be reached"
            : `the link check answered ${res.status}`,
        );
      }
      for (const [url, result] of Object.entries(res.json.results)) {
        results.set(url, result);
      }
      return results;
    };
    return createBatchedProber(probeBatch, { batchSize: BATCH_SIZE });
  }, [client]);
}
