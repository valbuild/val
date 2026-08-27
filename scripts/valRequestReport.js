/**
 * Why a Val request looked slow: was it SENT slowly, or sent late?
 *
 * Paste this whole file into the browser console on a page running the Studio,
 * reproduce whatever felt stuck, then run `valRequestReport()`. It prints a
 * summary and copies a JSON report to the clipboard — paste that back.
 *
 * ## What it separates, and why that is the whole question
 *
 * The devtools show a request as "pending" from the moment it is CREATED, which
 * includes the time it spends in the browser's own queue. A browser runs about
 * six connections per origin over HTTP/1.1, so the seventh simultaneous request
 * to `/api/val` has not been sent yet — and in the network panel that is
 * indistinguishable from a request the server is sitting on.
 *
 * Resource Timing knows the difference:
 *
 * - `queuedMs` = `requestStart - fetchStart`. Time before the bytes went out:
 *   the connection queue, plus connection setup. A big number here means the
 *   request was WAITING IN LINE. Nothing is wrong with the server.
 * - `serverMs`  = `responseStart - requestStart`. Time to the first byte once
 *   sent. A big number here means the server really was slow.
 * - `downloadMs` = `responseEnd - responseStart`.
 * - `inFlightAtStart` = how many other `/api/val` requests were open when this
 *   one was created — the queue depth it was joining.
 *
 * No timing hooks and no patched `fetch`: this reads the buffer the browser
 * already keeps, so it costs nothing until you call it and it captures
 * everything since the page loaded (including whatever you did before pasting
 * this in).
 */
(function () {
  const MATCH = "/api/val";

  /** Group the noisy paths so the summary is readable. */
  function bucket(pathname) {
    const path = pathname.replace(/^.*\/api\/val/, "");
    if (path.startsWith("/static")) {
      // The dev studio loads as ~600 of these, one per SPA source file. They are
      // the queue, so they are counted but never listed one by one.
      return "/static/*";
    }
    if (path.startsWith("/files")) {
      return "/files/*";
    }
    return path.split("?")[0];
  }

  function collect() {
    const entries = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes(MATCH))
      .map((entry) => {
        let pathname = entry.name;
        try {
          pathname = new URL(entry.name).pathname;
        } catch {
          // A relative or otherwise unparseable name: keep it as it is.
        }
        return {
          path: bucket(pathname),
          // Kept whole for the handful of requests that get listed, so a
          // `patch_id` or `keys` can be read off the report.
          url: entry.name.slice(entry.name.indexOf(MATCH)),
          startedAtMs: Math.round(entry.startTime),
          // `requestStart` is 0 when the response was cross-origin without
          // Timing-Allow-Origin, or served from the cache without a network
          // trip. Reported as null rather than as a zero that reads as "instant".
          queuedMs:
            entry.requestStart > 0
              ? Math.round(entry.requestStart - entry.fetchStart)
              : null,
          serverMs:
            entry.requestStart > 0 && entry.responseStart > 0
              ? Math.round(entry.responseStart - entry.requestStart)
              : null,
          downloadMs:
            entry.responseStart > 0
              ? Math.round(entry.responseEnd - entry.responseStart)
              : null,
          totalMs: Math.round(entry.duration),
          transferSize: entry.transferSize,
        };
      })
      .sort((a, b) => a.startedAtMs - b.startedAtMs);

    /*
     * How deep the queue was when each request was created.
     *
     * A sweep over start/end events rather than a nested scan, so this stays
     * cheap on the ~600-entry buffer a dev page produces.
     */
    const events = [];
    for (const entry of entries) {
      events.push({ at: entry.startedAtMs, delta: 1 });
      events.push({ at: entry.startedAtMs + entry.totalMs, delta: -1 });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let open = 0;
    let peak = 0;
    let peakAtMs = 0;
    const openAt = new Map();
    for (const event of events) {
      open += event.delta;
      openAt.set(event.at, open);
      if (open > peak) {
        peak = open;
        peakAtMs = event.at;
      }
    }
    for (const entry of entries) {
      entry.inFlightAtStart = openAt.get(entry.startedAtMs) ?? null;
    }
    return { entries, peak, peakAtMs };
  }

  window.valRequestReport = function valRequestReport(options) {
    const listLimit = (options && options.list) || 12;
    const { entries, peak, peakAtMs } = collect();
    if (entries.length === 0) {
      console.log(
        "No /api/val requests in the buffer. The page may have reloaded — the buffer is per-document.",
      );
      return null;
    }

    const byPath = new Map();
    for (const entry of entries) {
      const row = byPath.get(entry.path) || {
        path: entry.path,
        count: 0,
        queuedMs: 0,
        serverMs: 0,
        worstMs: 0,
      };
      row.count += 1;
      row.queuedMs += entry.queuedMs ?? 0;
      row.serverMs += entry.serverMs ?? 0;
      row.worstMs = Math.max(row.worstMs, entry.totalMs);
      byPath.set(entry.path, row);
    }
    const summary = [...byPath.values()]
      .map((row) => ({
        path: row.path,
        count: row.count,
        avgQueuedMs: Math.round(row.queuedMs / row.count),
        avgServerMs: Math.round(row.serverMs / row.count),
        worstMs: row.worstMs,
      }))
      .sort((a, b) => b.worstMs - a.worstMs);

    /*
     * The requests worth looking at, whichever way they were slow — sorted by
     * total, so a queued one and a genuinely slow one both surface. `/static/*`
     * is excluded from the listing (never from the counts): in dev it IS the
     * queue, and listing 600 of them buries everything else.
     */
    const slowest = entries
      .filter((entry) => entry.path !== "/static/*")
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, listLimit);

    const report = {
      capturedAt: new Date().toISOString(),
      href: location.href,
      total: entries.length,
      peakConcurrent: peak,
      peakAtMs,
      summary,
      slowest,
    };

    console.log(
      `%c${entries.length} /api/val requests, peak ${peak} in flight at ${peakAtMs}ms`,
      "font-weight:bold",
    );
    console.table(summary);
    console.log("Slowest (excluding /static/*):");
    console.table(slowest);
    console.log(
      "queuedMs = waiting in the browser's connection queue. serverMs = waiting on the server.\n" +
        "A large queuedMs with a small serverMs means the request was never the problem — it had not been sent yet.",
    );

    const json = JSON.stringify(report, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(
        () => console.log("Report copied to the clipboard."),
        () =>
          console.log(
            "Could not copy (the page may not be focused). The report is returned — right-click it and Copy object.",
          ),
      );
    }
    return report;
  };

  console.log(
    "valRequestReport() is ready. Reproduce the slow request, then run it.",
  );
})();
