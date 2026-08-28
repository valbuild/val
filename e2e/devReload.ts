import type { Page, WebSocket } from "@playwright/test";

/**
 * What made the page reload — observed, not inferred.
 *
 * The Studio is an ordinary route in the app it edits, so its document is
 * subject to whatever `next dev` decides to do about a file changing. Reasoning
 * about which of Val's own moves provokes that has been wrong more than once, so
 * this records the things that distinguish the candidates and lets a test read
 * them back:
 *
 * - **Document loads, per URL.** A second document request for `/val` in one
 *   session is not a reload of the Studio — it is Val loading the whole Studio
 *   route again inside the hidden draft-mode iframe. Only counting navigations
 *   cannot tell those apart, so requests are counted by URL.
 * - **The main document's identity.** A stamp written before any of the page's
 *   own scripts run. A changed stamp is proof the document was replaced; an
 *   unchanged one is proof it was not, however much re-rendering happened.
 * - **How it was replaced.** `performance`'s navigation type (`reload` versus
 *   `navigate`) plus CDP's own reason for the navigation. The trail lives in
 *   `sessionStorage`, so the document that comes up after a reload can report
 *   what the one before it saw — the only way to keep a record a reload
 *   destroys.
 *
 *   Note what is deliberately NOT here: wrapping `location.reload` and friends
 *   to catch the caller. It cannot work. `reload`, `assign`, `replace` and
 *   `href` are `[LegacyUnforgeable]`, which Chromium implements as own,
 *   non-configurable properties of each `location` — `Location.prototype` has
 *   none of them. A `defineProperty` on the prototype therefore SUCCEEDS and is
 *   never reached, so the wrapper reports "nothing called anything" for a page
 *   that called it every time. Attribution has to come from CDP or from
 *   bisecting the suspects, not from page script.
 * - **The dev HMR socket.** The messages `next dev` sends the client, verbatim.
 *   This is how "the dev server told this client to reload" is told apart from
 *   "something in the page navigated it".
 * - **Console lines.** A Fast Refresh full-reload warning names itself, and sits
 *   next to the navigation it caused.
 *
 * Everything is timestamped on one clock so the order can be read off.
 */
export type DevReloadLog = {
  /** Document (top-level or iframe) requests, in order. */
  documents: { at: number; url: string }[];
  /** RSC payload requests — Next's own soft navigations. */
  rsc: { at: number; url: string }[];
  /** Main-frame navigations, in order. */
  navigations: { at: number; url: string }[];
  /** Console messages, in order. */
  console: { at: number; type: string; text: string }[];
  /** Frames received on the `next dev` HMR socket, in order. */
  hmr: { at: number; payload: string }[];
  /**
   * Frames SENT on the dev HMR socket.
   *
   * This is what names the reload site. Next's dev client reports itself before
   * it reloads — `client-full-reload` (carrying the stack trace of the update it
   * could not apply) or `client-reload-page` — so a frame sent says which of the
   * client's four reload paths fired, where a received frame only says what the
   * server asked for.
   */
  sent: { at: number; payload: string }[];
  /**
   * Call stacks captured at `location.reload()`, via a CDP breakpoint.
   *
   * The only way to name the caller. `location.reload` is
   * `[LegacyUnforgeable]` — an own, non-configurable property of each
   * `location`, with nothing on `Location.prototype` — so page script cannot
   * wrap it: a `defineProperty` on the prototype succeeds and is never reached.
   * `Debugger.setBreakpointOnFunctionCall` on the function object itself is not
   * subject to that, and `Debugger.paused` carries the stack.
   */
  reloadStacks: { at: number; frames: string[] }[];
  /**
   * Navigations Chromium was asked to perform, with the REASON it recorded.
   *
   * This is the measurement that closes the case. `Location.prototype.href` is
   * `[LegacyUnforgeable]`, so it cannot be wrapped from page script — meaning a
   * `location.href = ...` assignment is invisible to the wrappers while still
   * producing a `reload`-typed navigation when the URL is unchanged. CDP names
   * the reason directly: `reload` is a real reload, `scriptInitiated` is the
   * page navigating itself.
   */
  requested: { at: number; reason: string; url: string; frame: string }[];
  /**
   * Open/close/error on the dev HMR socket.
   *
   * A dropped socket is a reload cause that arrives as NO message: Next's client
   * reloads when it reconnects to a server whose build has moved. Without this,
   * that case looks like a reload nothing asked for.
   */
  socket: { at: number; event: string; url: string }[];
};

/** One document's own account of how it came to exist, and what it then did. */
export type NavigationTrailEntry = {
  stamp: string;
  /** `performance`'s navigation type: `navigate`, `reload`, `back_forward`. */
  navigationType: string;
  url: string;
};

export type DevReloadObserver = {
  log: DevReloadLog;
  /**
   * The current main document's stamp, or `null` before the first load.
   *
   * Read it twice around an action: a different value means the document was
   * replaced.
   */
  stamp(): Promise<string | null>;
  /**
   * Every document this tab has had, oldest first, with how it arrived.
   */
  trail(): Promise<NavigationTrailEntry[]>;
  /** Document requests whose URL path is exactly this, ignoring the query. */
  documentsFor(pathname: string): { at: number; url: string }[];
  /** A human-readable dump, for a test that is measuring. */
  report(title: string): string;
  /** Forget everything recorded so far, so a case can measure one action. */
  reset(): void;
};

const STAMP_KEY = "__valDevReloadStamp";
const TRAIL_KEY = "__valDevReloadTrail";

/**
 * Start observing. Must be called before the first `goto`.
 *
 * The init script runs in every frame before the page's own scripts, so the
 * canvas frame and the hidden `/val` iframe are covered too, and a stamp is
 * never missed because a load was fast.
 */
export async function observeDevReloads(
  page: Page,
): Promise<DevReloadObserver> {
  const started = Date.now();
  const now = () => Date.now() - started;
  const log: DevReloadLog = {
    documents: [],
    rsc: [],
    navigations: [],
    console: [],
    hmr: [],
    socket: [],
    requested: [],
    sent: [],
    reloadStacks: [],
  };

  await page.addInitScript(
    ({ stampKey, trailKey }: { stampKey: string; trailKey: string }) => {
      const stamp = Math.random().toString(36).slice(2, 10);
      const bag = window as unknown as Record<string, string>;
      bag[stampKey] = stamp;

      // Only the top document keeps a trail. The canvas frame and the hidden
      // iframe load constantly and legitimately; mixing them in would bury the
      // one document whose replacement is the bug.
      if (window.top !== window.self) {
        return;
      }

      type Entry = {
        stamp: string;
        navigationType: string;
        url: string;
      };
      const read = (): Entry[] => {
        try {
          const raw = window.sessionStorage.getItem(trailKey);
          return raw === null ? [] : (JSON.parse(raw) as Entry[]);
        } catch {
          return [];
        }
      };
      const write = (entries: Entry[]) => {
        try {
          window.sessionStorage.setItem(trailKey, JSON.stringify(entries));
        } catch {
          // A document with no storage access still gets the stamp, which is
          // enough to see THAT it was replaced — just not how.
        }
      };

      const navigation = performance.getEntriesByType("navigation")[0];
      const entry: Entry = {
        stamp,
        navigationType:
          navigation instanceof PerformanceNavigationTiming
            ? navigation.type
            : "unknown",
        url: window.location.href,
      };
      const entries = read();
      entries.push(entry);
      write(entries);
    },
    { stampKey: STAMP_KEY, trailKey: TRAIL_KEY },
  );

  // Chromium-only, which is what this project runs. Attached before the first
  // navigation so the very first load is in the record too.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Debugger.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Debugger.paused", (event) => {
    log.reloadStacks.push({
      at: now(),
      frames: event.callFrames
        .slice(0, 12)
        .map(
          (frame) =>
            `${frame.functionName || "(anonymous)"} @ ${frame.url}:${
              frame.location.lineNumber + 1
            }`,
        ),
    });
    void cdp.send("Debugger.resume").catch(() => {
      // The document may already be going away, which is the normal case here.
    });
  });

  /**
   * Arm the breakpoint for the current document.
   *
   * Re-armed per document: the function object dies with its realm, so the
   * objectId from the previous page is stale the moment a reload lands.
   */
  const armReloadBreakpoint = async () => {
    try {
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: "location.reload",
      });
      const objectId = evaluated.result.objectId;
      if (objectId === undefined) return;
      await cdp.send("Debugger.setBreakpointOnFunctionCall", { objectId });
    } catch {
      // A navigation in flight makes this fail harmlessly; the next arm wins.
    }
  };

  cdp.on("Page.frameRequestedNavigation", (event) => {
    log.requested.push({
      at: now(),
      reason: event.reason,
      url: event.url,
      frame: event.frameId,
    });
  });

  page.on("request", (request) => {
    const url = request.url();
    if (request.resourceType() === "document") {
      log.documents.push({ at: now(), url });
      return;
    }
    if (url.includes("_rsc=")) {
      log.rsc.push({ at: now(), url });
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    log.navigations.push({ at: now(), url: frame.url() });
    void armReloadBreakpoint();
  });
  page.on("console", (message) => {
    log.console.push({ at: now(), type: message.type(), text: message.text() });
  });
  page.on("websocket", (socket: WebSocket) => {
    // EVERY socket, not only `next dev`'s. In dev the Studio SPA is served by
    // Vite through the Next app (`packages/ui/src/server.ts` proxies
    // `/api/val/static`), so a second HMR client — with its own reload
    // behaviour — is live in the Studio document. Filtering to `/_next/` hid it,
    // which is how a reload with "no dev-server instruction" came to look
    // unexplained.
    log.socket.push({ at: now(), event: "open", url: socket.url() });
    socket.on("close", () => {
      log.socket.push({ at: now(), event: "close", url: socket.url() });
    });
    socket.on("socketerror", (error) => {
      log.socket.push({
        at: now(),
        event: `error ${error}`,
        url: socket.url(),
      });
    });
    socket.on("framesent", (frame) => {
      const payload =
        typeof frame.payload === "string"
          ? frame.payload
          : frame.payload.toString("utf-8");
      log.sent.push({ at: now(), payload });
    });
    socket.on("framereceived", (frame) => {
      const payload =
        typeof frame.payload === "string"
          ? frame.payload
          : frame.payload.toString("utf-8");
      log.hmr.push({ at: now(), payload });
    });
  });

  const observer: DevReloadObserver = {
    log,
    async stamp() {
      return page.evaluate(
        ({ key }) => {
          const bag = window as unknown as Record<string, string | undefined>;
          return bag[key] ?? null;
        },
        { key: STAMP_KEY },
      );
    },
    async trail() {
      return page.evaluate(
        ({ key }) => {
          try {
            const raw = window.sessionStorage.getItem(key);
            return raw === null
              ? []
              : (JSON.parse(raw) as NavigationTrailEntry[]);
          } catch {
            return [];
          }
        },
        { key: TRAIL_KEY },
      );
    },
    documentsFor(pathname) {
      return log.documents.filter((entry) => {
        try {
          return new URL(entry.url).pathname === pathname;
        } catch {
          return false;
        }
      });
    },
    report(title) {
      const lines = [`--- ${title} ---`];
      const rows: { at: number; text: string }[] = [
        ...log.documents.map((d) => ({ at: d.at, text: `DOCUMENT ${d.url}` })),
        ...log.rsc.map((r) => ({ at: r.at, text: `RSC      ${r.url}` })),
        ...log.navigations.map((n) => ({
          at: n.at,
          text: `NAVIGATE ${n.url}`,
        })),
        ...log.hmr.map((h) => ({
          at: h.at,
          // Truncated, EXCEPT a frame that might carry a reload instruction:
          // those are the whole point, and the action name can sit anywhere in
          // a frame that also carries a module list.
          text: `HMR      ${
            /reload|action|fullReload|RELOAD/i.test(h.payload)
              ? h.payload
              : h.payload.slice(0, 160)
          }`,
        })),
        ...log.reloadStacks.map((r) => ({
          at: r.at,
          text: `RELOAD@  ${r.frames.join("\n           ")}`,
        })),
        ...log.sent.map((s) => ({
          at: s.at,
          // Never truncated: the stack trace in a `client-full-reload` is the
          // answer this whole harness exists to get.
          text: `SENT     ${s.payload}`,
        })),
        ...log.requested.map((r) => ({
          at: r.at,
          text: `REQUESTED reason=${r.reason} ${r.url}`,
        })),
        ...log.socket.map((s) => ({
          at: s.at,
          text: `SOCKET   ${s.event} ${s.url}`,
        })),
        ...log.console.map((c) => ({
          at: c.at,
          text: `CONSOLE  [${c.type}] ${c.text.slice(0, 220)}`,
        })),
      ];
      rows.sort((a, b) => a.at - b.at);
      for (const row of rows) {
        lines.push(`${String(row.at).padStart(6)}ms  ${row.text}`);
      }
      return lines.join("\n");
    },
    reset() {
      log.documents.length = 0;
      log.rsc.length = 0;
      log.navigations.length = 0;
      log.console.length = 0;
      log.hmr.length = 0;
      log.socket.length = 0;
      log.requested.length = 0;
      log.sent.length = 0;
      log.reloadStacks.length = 0;
    },
  };
  return observer;
}

/** The trail, formatted for a test that is measuring. */
export function reportTrail(trail: NavigationTrailEntry[]): string {
  const lines = ["--- how each document arrived ---"];
  for (const [index, entry] of trail.entries()) {
    lines.push(
      `${index + 1}. ${entry.stamp} via ${entry.navigationType}  ${entry.url}`,
    );
  }
  return lines.join("\n");
}
