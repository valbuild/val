/**
 * What went wrong on the page in the Studio's preview: the assistant's
 * `read_page_log`, and the counts on every `read_page`.
 *
 * Looking at a page does not say that it threw. A section that rendered
 * nothing because its component crashed looks exactly like a section with
 * nothing in it, and an image that 404'd is an empty box. So the page keeps a
 * short log of what it said went wrong, and the Studio can ask for it.
 *
 * Plain DOM and in `shared` for the reason `pageInspection.ts` is: the canvas
 * bridge (`@valbuild/next`, `@valbuild/tanstack`) runs it inside the page,
 * which is the only place any of this can be heard. Only what `readPageLog`
 * returns crosses the frame (`valCanvasProtocol.ts`).
 *
 * ## What is caught
 *
 * - `console.error` and `console.warn`, wrapped: the page's own console gets
 *   the same call with the same arguments, so it prints exactly what it did
 *   (one frame of this module is in the stack devtools shows for the line).
 * - Uncaught exceptions (`error` on the window) and rejected promises nobody
 *   handled (`unhandledrejection`).
 * - Elements whose resource did not load -- `img`, `script`, `link`, `video`,
 *   `audio`, `source`, `iframe` -- through a capture-phase `error` listener,
 *   since those events do not bubble.
 * - `fetch` calls that failed outright or answered 400 or more.
 *
 * ## What is not
 *
 * - Anything before {@link installPageLog} ran. The bindings call it when
 *   their provider's module is evaluated in the canvas frame, which is before
 *   React hydrates -- so hydration errors are caught -- but after the app's
 *   own modules that were evaluated first, and after any inline script. Two
 *   things are looked for after the fact: `<img>` elements already broken,
 *   and requests the browser's resource timing says answered 400 or more
 *   (`responseStatus`, where the browser has it). An exception thrown before
 *   that is gone.
 * - What happened on the SERVER. A route that threw while rendering on the
 *   server sends its error page, which `read_page` reads; its stack is in the
 *   server's own log.
 * - `XMLHttpRequest`, `sendBeacon`, WebSocket and EventSource traffic: only
 *   `fetch` is wrapped.
 * - `console.log`, `info` and `debug`: chatter, and the page's own business.
 * - Val's own: lines Val's logger printed (`[val]`) and requests to Val's API
 *   (`/api/val`), which are the Studio talking to its server and not the page.
 */

import { isValCanvasFrame } from "./valCanvasProtocol";

/** How many entries the log keeps: older ones make room for new ones. */
export const PAGE_LOG_SIZE = 200;

/** How long one entry's text may be, before it is shortened. */
export const PAGE_LOG_TEXT_LENGTH = 600;

export type PageLogLevel = "error" | "warn";

/** Where an entry came from. */
export type PageLogSource =
  /** `console.error` / `console.warn`. */
  | "console"
  /** An uncaught exception. */
  | "exception"
  /** A rejected promise nobody handled. */
  | "rejection"
  /** An element whose image, script, stylesheet or media did not load. */
  | "resource"
  /** A `fetch` that failed, or answered 400 or more. */
  | "request";

export type PageLogEntry = {
  level: PageLogLevel;
  source: PageLogSource;
  /** What was said, shortened to {@link PAGE_LOG_TEXT_LENGTH}. */
  text: string;
  /** The page's path when it happened: a client-side navigation moves it. */
  path: string;
  /** Milliseconds after the document started loading. */
  at: number;
  /** The URL that did not load: a resource or a request. */
  url?: string;
  /** The status a request answered with. Absent when it never answered. */
  status?: number;
  /** The tag of the element whose resource did not load. */
  tag?: string;
  /** How many times the same thing happened in a row, when more than once. */
  repeated?: number;
};

/** How many of each, as `read_page` reports them. */
export type PageLogCounts = {
  errors: number;
  warnings: number;
  failedRequests: number;
};

/** What `readPageLog` answers. */
export type PageLogSnapshot = {
  /** The page's path now. */
  path: string;
  /** Oldest first. */
  entries: PageLogEntry[];
  /**
   * Whether `entries` is only what happened since the page last navigated
   * (client-side: a new document starts a new log anyway).
   */
  sinceNavigation: boolean;
  /** How many entries were pushed out of the log to make room, ever. */
  dropped: number;
  /**
   * When the log started listening, in milliseconds after the document
   * started loading: what happened before is not in it.
   */
  startedAt: number;
};

export type PageLog = {
  /** What is in it, filtered. */
  read: (options?: {
    sinceNavigation?: boolean;
    levels?: readonly PageLogLevel[];
    /**
     * Only what was recorded after this {@link PageLog.mark}: what an
     * interaction caused (`pageInteraction.ts`). Overrides
     * `sinceNavigation`, since a mark is later than any navigation before
     * it. An entry that repeated across the mark counts only its repeats
     * after it.
     */
    since?: number;
  }) => PageLogSnapshot;
  /**
   * Where the log is now, to read from later with `since`: how many times
   * it has recorded anything.
   */
  mark: () => number;
  /**
   * How many of the page's `fetch` calls have not answered yet (Val's own
   * excluded): what an interaction waits on before it calls the page
   * settled.
   */
  inFlight: () => number;
  /** How many of each since the page last navigated. */
  counts: () => PageLogCounts;
  /**
   * The page may have navigated: what the bridge calls when it sees the
   * address move. The log also looks for itself whenever it records or is
   * read, so this only makes a move with nothing logged during it count.
   */
  noteLocation: () => void;
  /** Stop listening and put the page's own functions back. */
  uninstall: () => void;
};

export type PageLogOptions = {
  /** Requests that are not the page's own (Val's API, by default). */
  ignoreUrl?: (url: URL) => boolean;
  size?: number;
};

/** Where the one log of a window is kept, so installing twice is once. */
const PAGE_LOG = Symbol.for("valbuild.pageLog");

/** The window's log, if one is installed. */
export function pageLogOf(win: Window): PageLog | null {
  const log: unknown = Reflect.get(win, PAGE_LOG);
  return isPageLog(log) ? log : null;
}

function isPageLog(value: unknown): value is PageLog {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "read") === "function" &&
    typeof Reflect.get(value, "counts") === "function"
  );
}

/** What a capture hands `record`: its text may be described lazily. */
type Recorded = Omit<PageLogEntry, "path" | "at" | "text" | "repeated"> & {
  text: string | (() => string);
};

/** Val's own API: what the provider says to its server. */
function isValApi(url: URL, win: Window): boolean {
  return (
    url.origin === win.location.origin &&
    (url.pathname === "/api/val" || url.pathname.startsWith("/api/val/"))
  );
}

/**
 * Start keeping the page's log, or return the one already kept: a second
 * call (the provider's module, then the bridge) changes nothing.
 */
export function installPageLog(
  // The window as `window` is typed: its `console` and `fetch` are the
  // global ones, which a bare `Window` does not say it has.
  win: Window & typeof globalThis,
  options: PageLogOptions = {},
): PageLog {
  const existing = pageLogOf(win);
  if (existing !== null) return existing;

  const size = Math.max(1, options.size ?? PAGE_LOG_SIZE);
  const ignoreUrl = options.ignoreUrl ?? ((url: URL) => isValApi(url, win));
  const startedAt = Math.round(now(win));
  /** The log, with a marker where the page navigated. */
  const items: Array<PageLogEntry | { navigation: string }> = [];
  let dropped = 0;
  let lastPath = currentPath(win);
  /** Every time `record` recorded something, a repeat included: `mark`. */
  let recorded = 0;
  /**
   * Which records each entry is: they are consecutive, since only the last
   * entry is ever repeated. For `read({ since })`.
   */
  const recordsOf = new WeakMap<
    PageLogEntry,
    { first: number; last: number }
  >();
  /** `fetch` calls not answered yet: `inFlight`. */
  let pending = 0;

  const push = (item: PageLogEntry | { navigation: string }) => {
    items.push(item);
    while (items.length > size) {
      const gone = items.shift();
      if (gone !== undefined && !("navigation" in gone)) dropped++;
    }
  };
  const noteLocation = () => {
    const path = currentPath(win);
    if (path === lastPath) return;
    lastPath = path;
    push({ navigation: path });
  };
  /**
   * Whether `record` is running: a getter or a `toJSON` of the page's that
   * logs while its value is being described would otherwise recurse until
   * the stack runs out.
   */
  let recording = false;
  const record = (entry: Recorded) => {
    if (recording) return;
    recording = true;
    try {
      noteLocation();
      // Described here, inside the `try`: describing a value the page handed
      // over (a Proxy, a throwing getter) must not throw out of a listener.
      const text = shorten(
        typeof entry.text === "function" ? entry.text() : entry.text,
      );
      const url = entry.url === undefined ? undefined : shorten(entry.url);
      const last = items[items.length - 1];
      if (
        last !== undefined &&
        !("navigation" in last) &&
        last.level === entry.level &&
        last.source === entry.source &&
        last.text === text &&
        last.url === url &&
        last.status === entry.status
      ) {
        // A render loop logs the same line hundreds of times: one entry
        // with a count keeps the rest of the log.
        last.repeated = (last.repeated ?? 1) + 1;
        recorded++;
        const records = recordsOf.get(last);
        if (records !== undefined) records.last = recorded;
        return;
      }
      const pushed: PageLogEntry = {
        level: entry.level,
        source: entry.source,
        text,
        path: lastPath,
        at: Math.round(now(win)),
        ...(url !== undefined ? { url } : {}),
        ...(entry.status !== undefined ? { status: entry.status } : {}),
        ...(entry.tag !== undefined ? { tag: entry.tag } : {}),
      };
      recorded++;
      recordsOf.set(pushed, { first: recorded, last: recorded });
      push(pushed);
    } catch {
      // The log must never be what breaks the page.
    } finally {
      recording = false;
    }
  };

  // --- console.error / console.warn ---------------------------------------
  const pageConsole = win.console;
  const originalError = pageConsole.error;
  const originalWarn = pageConsole.warn;
  const wrapConsole = (
    original: (...args: unknown[]) => void,
    level: PageLogLevel,
  ) =>
    function (this: unknown, ...args: unknown[]) {
      try {
        if (!isValLine(args)) {
          record({
            level,
            source: "console",
            text: () => formatConsoleArgs(args),
          });
        }
      } catch {
        // An argument that cannot be printed is still the page's to print.
      }
      return original.apply(this, args);
    };
  const wrappedError = wrapConsole(originalError, "error");
  const wrappedWarn = wrapConsole(originalWarn, "warn");
  pageConsole.error = wrappedError;
  pageConsole.warn = wrappedWarn;

  // --- uncaught exceptions, and resources that did not load ---------------
  const onError = (event: Event) => {
    const target = event.target;
    if (target !== null && target !== win && isElement(target)) {
      const url = resourceUrl(target);
      if (url === null || isIgnored(url, win, ignoreUrl)) return;
      const tag = target.tagName.toLowerCase();
      record({
        level: "error",
        source: "resource",
        text: `<${tag}> did not load ${url}`,
        url,
        tag,
      });
      return;
    }
    if (!isErrorEvent(event)) return;
    record({
      level: "error",
      source: "exception",
      text: () =>
        event.error !== undefined && event.error !== null
          ? describeValue(event.error)
          : `${event.message}${
              event.filename !== ""
                ? ` (${event.filename}:${event.lineno}:${event.colno})`
                : ""
            }`,
    });
  };
  // Capture: an element's `error` does not bubble, and the window sees it
  // only on the way down.
  win.addEventListener("error", onError, true);

  const onRejection = (event: Event) => {
    record({
      level: "error",
      source: "rejection",
      text: () =>
        `Unhandled rejection: ${describeValue(Reflect.get(event, "reason"))}`,
    });
  };
  win.addEventListener("unhandledrejection", onRejection);

  // --- fetch ---------------------------------------------------------------
  const originalFetch = typeof win.fetch === "function" ? win.fetch : null;
  const wrappedFetch =
    originalFetch === null
      ? null
      : function (
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> {
          let url: URL | null = null;
          let method = "GET";
          try {
            url = requestUrl(input, win);
            method = String(
              init?.method ?? (isRequest(input) ? input.method : "GET"),
            ).toUpperCase();
          } catch {
            // Not ours to understand: the page's fetch goes ahead regardless.
          }
          // On the window, whatever it was called on: `fetch` called on
          // anything else throws "Illegal invocation".
          const answer = originalFetch.call(win, input, init);
          if (url === null || isIgnored(url, win, ignoreUrl)) return answer;
          const href = url.href;
          // Counted until it answers, either way: `inFlight`.
          pending++;
          let answered = false;
          const done = () => {
            if (answered) return;
            answered = true;
            pending = Math.max(0, pending - 1);
          };
          /*
           * The page is handed a promise DERIVED from its fetch, never the
           * fetch's own with a handler on it. Any `then` on a promise marks
           * its rejection handled, so observing `answer` and returning it
           * would silence the `unhandledrejection` of a fire-and-forget fetch
           * that failed -- which the page's own error reporting listens for.
           * The derived one settles exactly as `answer` does (the same
           * response, the same error, rethrown), so a rejection nobody
           * handles is still unhandled, on the promise the page holds.
           *
           * Observing must never change the outcome: each callback looks in a
           * `try`, and passes the value through outside it.
           */
          return answer.then(
            (response) => {
              done();
              try {
                const status: unknown = Reflect.get(Object(response), "status");
                if (typeof status === "number" && status >= 400) {
                  const statusText: unknown = Reflect.get(
                    Object(response),
                    "statusText",
                  );
                  record({
                    level: "error",
                    source: "request",
                    text: `${method} ${href} answered ${status}${
                      typeof statusText === "string" && statusText !== ""
                        ? ` ${statusText}`
                        : ""
                    }`,
                    url: href,
                    status,
                  });
                }
              } catch {
                // Not a response we can read: the page gets it as it came.
              }
              return response;
            },
            (error: unknown) => {
              done();
              try {
                // An abort is the page changing its mind, not a failure.
                if (!isAbort(error)) {
                  record({
                    level: "error",
                    source: "request",
                    text: () =>
                      `${method} ${href} failed: ${describeValue(error)}`,
                    url: href,
                  });
                }
              } catch {
                // The page's failure is passed on, whatever happened here.
              }
              throw error;
            },
          );
        };
  if (wrappedFetch !== null) win.fetch = wrappedFetch;

  // --- what happened before we were listening ------------------------------
  backfill(win, ignoreUrl, record);

  const onPopState = () => noteLocation();
  win.addEventListener("popstate", onPopState);

  const log: PageLog = {
    read: (readOptions = {}) => {
      noteLocation();
      const since = readOptions.since;
      const sinceNavigation =
        since === undefined && readOptions.sinceNavigation !== false;
      const levels = readOptions.levels;
      const entries = entriesOf(items, sinceNavigation).filter(
        (entry) =>
          levels === undefined ||
          levels.length === 0 ||
          levels.includes(entry.level),
      );
      const copies: PageLogEntry[] = [];
      for (const entry of entries) {
        if (since === undefined) {
          copies.push({ ...entry });
          continue;
        }
        const records = recordsOf.get(entry);
        if (records === undefined || records.last <= since) continue;
        // Only the times it happened after the mark.
        const times = records.last - Math.max(since, records.first - 1);
        const { repeated: _all, ...rest } = entry;
        copies.push(times > 1 ? { ...rest, repeated: times } : rest);
      }
      return {
        path: currentPath(win),
        entries: copies,
        sinceNavigation,
        dropped,
        startedAt,
      };
    },
    counts: () => {
      noteLocation();
      return countEntries(entriesOf(items, true));
    },
    mark: () => recorded,
    inFlight: () => pending,
    noteLocation,
    uninstall: () => {
      // Only what is still ours: something wrapped after us keeps its own.
      if (pageConsole.error === wrappedError) pageConsole.error = originalError;
      if (pageConsole.warn === wrappedWarn) pageConsole.warn = originalWarn;
      if (originalFetch !== null && win.fetch === wrappedFetch) {
        win.fetch = originalFetch;
      }
      win.removeEventListener("error", onError, true);
      win.removeEventListener("unhandledrejection", onRejection);
      win.removeEventListener("popstate", onPopState);
      if (Reflect.get(win, PAGE_LOG) === log)
        Reflect.deleteProperty(win, PAGE_LOG);
    },
  };
  Reflect.set(win, PAGE_LOG, log);
  return log;
}

/**
 * Start the log if this document is in the Studio's canvas, and only then:
 * what the bindings call when their provider's module is evaluated, which is
 * the earliest moment Val's code runs in the page -- before React hydrates.
 * A visitor's page (not in a frame, or framed by anything but the Studio)
 * is left exactly as it was. Does nothing on the server.
 */
export function installPageLogInCanvasFrame(
  /**
   * What else the bridge needs before it mounts that can be known this early:
   * the bindings pass whether Val is enabled in this browser (the
   * `val_enable` cookie), which is what mounts the overlay -- and so the
   * bridge -- outside the demo. What can only be known later (draft mode,
   * the demo prop) is left to the bridge, which starts the log itself when
   * it mounts in a frame.
   */
  isEnabled: () => boolean = () => true,
): PageLog | null {
  if (typeof window === "undefined") return null;
  try {
    return isInStudioFrame(window) && isEnabled()
      ? installPageLog(window)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether this document is the Studio's canvas AND framed. The canvas
 * parameter alone is not enough: a visitor can open `?val_canvas=1` in a tab
 * of its own -- "open frame in new tab", a link someone shared -- and that is
 * a visitor's page, which the log never touches.
 */
export function isInStudioFrame(win: Window): boolean {
  try {
    if (win.parent === win) return false;
    return isValCanvasFrame(win.location.search, parentPathname(win));
  } catch {
    return false;
  }
}

/** The framing window's path: `null` at the top, or on another origin. */
function parentPathname(win: Window): string | null {
  try {
    return win.parent === win ? null : win.parent.location.pathname;
  } catch {
    return null;
  }
}

/** How many of each, in a list of entries. */
export function countEntries(entries: readonly PageLogEntry[]): PageLogCounts {
  const counts: PageLogCounts = { errors: 0, warnings: 0, failedRequests: 0 };
  for (const entry of entries) {
    const times = entry.repeated ?? 1;
    if (entry.source === "request" || entry.source === "resource") {
      counts.failedRequests += times;
    } else if (entry.level === "error") {
      counts.errors += times;
    } else {
      counts.warnings += times;
    }
  }
  return counts;
}

function entriesOf(
  items: ReadonlyArray<PageLogEntry | { navigation: string }>,
  sinceNavigation: boolean,
): PageLogEntry[] {
  let from = 0;
  if (sinceNavigation) {
    for (let i = items.length - 1; i >= 0; i--) {
      if ("navigation" in items[i]) {
        from = i + 1;
        break;
      }
    }
  }
  const entries: PageLogEntry[] = [];
  for (let i = from; i < items.length; i++) {
    const item = items[i];
    if (!("navigation" in item)) entries.push(item);
  }
  return entries;
}

/**
 * Look for what failed before the log was listening: images already broken,
 * and requests the resource timing says answered 400 or more.
 */
function backfill(
  win: Window,
  ignoreUrl: (url: URL) => boolean,
  record: (entry: Recorded) => void,
): void {
  const seen = new Set<string>();
  try {
    for (const img of Array.from(win.document.images)) {
      const src = img.currentSrc || img.src;
      if (!src || !img.complete || img.naturalWidth !== 0) continue;
      const url = parseUrl(src, win);
      if (url === null || isIgnored(url, win, ignoreUrl)) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      record({
        level: "error",
        source: "resource",
        text: `<img> did not load ${url.href}`,
        url: url.href,
        tag: "img",
      });
    }
  } catch {
    // Nothing to look back at.
  }
  try {
    const entries = win.performance?.getEntriesByType?.("resource") ?? [];
    for (const timing of entries) {
      const status: unknown = Reflect.get(timing, "responseStatus");
      if (typeof status !== "number" || status < 400) continue;
      const url = parseUrl(timing.name, win);
      if (url === null || isIgnored(url, win, ignoreUrl)) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      record({
        level: "error",
        source: "request",
        text: `${url.href} answered ${status}`,
        url: url.href,
        status,
      });
    }
  } catch {
    // Not every browser keeps resource timing, or says the status.
  }
}

function now(win: Window): number {
  try {
    return win.performance.now();
  } catch {
    return 0;
  }
}

/**
 * The page's path: what a navigation moves. Not its query: a router that
 * canonicalises it, or filters kept in the URL, change the query with
 * `replaceState` on the same page -- often right after hydration, whose
 * errors are what this log is most for -- and Val's own parameters
 * (`val_canvas`, `val_quick`) come and go with it.
 */
function currentPath(win: Window): string {
  try {
    return win.location.pathname;
  } catch {
    return "";
  }
}

function shorten(text: string): string {
  return text.length > PAGE_LOG_TEXT_LENGTH
    ? `${text.slice(0, PAGE_LOG_TEXT_LENGTH - 1)}…`
    : text;
}

/** A line Val's own logger printed: it prefixes every one. */
function isValLine(args: unknown[]): boolean {
  return typeof args[0] === "string" && args[0].startsWith("[val]");
}

/**
 * The arguments of a console call as one line, the way the console would
 * print them: `%s`-style substitutions applied, and `%c` (a style) dropped
 * along with its argument. Bounded: it stops describing once the line is
 * {@link PAGE_LOG_TEXT_LENGTH} long, however much the page logged.
 */
export function formatConsoleArgs(args: readonly unknown[]): string {
  const [first, ...others] = args;
  let rest: unknown[] = [...args];
  let head = "";
  if (typeof first === "string" && /%[sdifoOjc]/.test(first)) {
    rest = others;
    head = first
      .slice(0, PAGE_LOG_TEXT_LENGTH)
      .replace(/%([sdifoOjc%])/g, (match, kind: string) => {
        if (kind === "%") return "%";
        if (rest.length === 0) return match;
        const value = rest.shift();
        if (kind === "c") return "";
        // Numbers from numbers and strings alone: `Number()` of an object
        // would call its `valueOf`, which is the page's code.
        const number =
          typeof value === "number" || typeof value === "string"
            ? Number(value)
            : NaN;
        if (kind === "d" || kind === "i") return String(Math.trunc(number));
        if (kind === "f") return String(number);
        return describeValue(value);
      });
  }
  let line = head;
  for (const value of rest) {
    if (line.length >= PAGE_LOG_TEXT_LENGTH) break;
    const part = describeValue(value, PAGE_LOG_TEXT_LENGTH - line.length);
    line = line === "" ? part : part === "" ? line : `${line} ${part}`;
  }
  return shorten(line);
}

/**
 * One value as text, in at most about `budget` characters: an error with the
 * top of its stack, an object as its own data properties.
 *
 * It never calls the page's code to do it -- no `toJSON`, no getters, no
 * `toString` of the page's own -- because describing a value must not change
 * it, and a value logged in a render loop is described on every render: it
 * reads only own DATA properties, a few levels down, and stops at the budget.
 */
export function describeValue(
  value: unknown,
  budget: number = PAGE_LOG_TEXT_LENGTH,
): string {
  try {
    if (typeof value === "string") return value.slice(0, budget);
    if (value instanceof Error) return describeError(value);
    const out: string[] = [];
    let length = 0;
    const emit = (text: string) => {
      out.push(text);
      length += text.length;
    };
    describeInto(value, 0, new Set(), emit, () => length >= budget);
    return out.join("").slice(0, budget);
  } catch {
    return "[unreadable value]";
  }
}

/** How deep an object is described before it is `{…}`. */
const DESCRIBE_DEPTH = 3;
/** How many properties of one object, at most. */
const DESCRIBE_KEYS = 20;

function describeInto(
  value: unknown,
  depth: number,
  seen: Set<object>,
  emit: (text: string) => void,
  full: () => boolean,
): void {
  if (full()) return;
  if (value === null) return emit("null");
  switch (typeof value) {
    case "string":
      return emit(JSON.stringify(value.slice(0, 200)));
    case "number":
    case "boolean":
    case "bigint":
      return emit(String(value));
    case "undefined":
      return emit("undefined");
    case "symbol":
      return emit(
        value.description ? `Symbol(${value.description})` : "Symbol()",
      );
    case "function":
      return emit("[function]");
  }
  if (typeof value !== "object") return emit("?");
  if (value instanceof Error) return emit(describeError(value));
  if (seen.has(value)) return emit("[circular]");
  if (depth >= DESCRIBE_DEPTH)
    return emit(Array.isArray(value) ? "[…]" : "{…}");
  seen.add(value);
  const isArray = Array.isArray(value);
  const keys = Object.keys(value);
  emit(isArray ? "[" : "{");
  let shown = 0;
  for (const key of keys) {
    if (full()) break;
    if (shown >= DESCRIBE_KEYS) {
      emit(", …");
      break;
    }
    // Own DATA properties only: a getter is the page's code.
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) continue;
    if (shown > 0) emit(",");
    if (!isArray) emit(`${JSON.stringify(key)}:`);
    describeInto(descriptor.value, depth + 1, seen, emit, full);
    shown++;
  }
  if (!full()) emit(isArray ? "]" : "}");
  seen.delete(value);
}

/** An error: its name and message, and the top of its stack. */
function describeError(error: Error): string {
  const own = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  };
  const named = own("name");
  const message = own("message");
  // `name` is usually on the prototype; the constructor's is the page's
  // class, read without calling anything.
  const name =
    typeof named === "string"
      ? named
      : typeof error.constructor === "function" && error.constructor.name
        ? error.constructor.name
        : "Error";
  const head = `${name}: ${typeof message === "string" ? message : ""}`;
  // `stack` is where the engine says it is; reading it is what every error
  // reporter does, and the only way to say where.
  let stack: unknown;
  try {
    stack = error.stack;
  } catch {
    stack = undefined;
  }
  if (typeof stack !== "string") return head;
  // The first lines of the stack say where; the rest is the framework.
  const frames = stack
    .slice(0, 4000)
    .split("\n")
    .filter((line) => /^\s*at\s|@/.test(line))
    .slice(0, 4)
    .map((line) => line.trim());
  return frames.length > 0 ? `${head}\n${frames.join("\n")}` : head;
}

function isErrorEvent(event: Event): event is ErrorEvent {
  return typeof Reflect.get(event, "message") === "string" && "error" in event;
}

function isElement(target: EventTarget): target is Element {
  return typeof Reflect.get(target, "tagName") === "string";
}

/** The elements whose `error` means a resource did not load. */
const RESOURCE_TAGS = new Set([
  "img",
  "script",
  "link",
  "video",
  "audio",
  "source",
  "iframe",
  "track",
]);

/** The URL an element failed to load, or `null` for one that loads nothing. */
function resourceUrl(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  if (!RESOURCE_TAGS.has(tag)) return null;
  // The resolved address: `currentSrc` for one picked from a `srcset`, the
  // property (absolute) before the attribute (as written).
  const attribute = tag === "link" ? "href" : "src";
  for (const candidate of [
    Reflect.get(element, "currentSrc"),
    Reflect.get(element, attribute),
    element.getAttribute(attribute),
  ]) {
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return null;
}

function parseUrl(value: string, win: Window): URL | null {
  try {
    return new URL(value, win.location.href);
  } catch {
    return null;
  }
}

function isRequest(input: unknown): input is Request {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof Reflect.get(input, "url") === "string" &&
    typeof Reflect.get(input, "method") === "string"
  );
}

function requestUrl(input: RequestInfo | URL, win: Window): URL | null {
  if (typeof input === "string") return parseUrl(input, win);
  if (input instanceof URL) return input;
  if (isRequest(input)) return parseUrl(input.url, win);
  return null;
}

function isIgnored(
  url: URL | string,
  win: Window,
  ignoreUrl: (url: URL) => boolean,
): boolean {
  const parsed = typeof url === "string" ? parseUrl(url, win) : url;
  if (parsed === null) return false;
  // `data:` and `blob:` are the page's own bytes; a failure there is not a
  // request that failed.
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  try {
    return ignoreUrl(parsed);
  } catch {
    return false;
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "name") === "AbortError"
  );
}
