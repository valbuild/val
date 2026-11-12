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
  }) => PageLogSnapshot;
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
  const record = (
    entry: Omit<PageLogEntry, "path" | "at" | "text"> & {
      text: string;
    },
  ) => {
    try {
      noteLocation();
      const text = shorten(entry.text);
      const last = items[items.length - 1];
      if (
        last !== undefined &&
        !("navigation" in last) &&
        last.level === entry.level &&
        last.source === entry.source &&
        last.text === text &&
        last.url === entry.url &&
        last.status === entry.status
      ) {
        // A render loop logs the same line hundreds of times: one entry
        // with a count keeps the rest of the log.
        last.repeated = (last.repeated ?? 1) + 1;
        return;
      }
      push({
        ...entry,
        text,
        path: lastPath,
        at: Math.round(now(win)),
      });
    } catch {
      // The log must never be what breaks the page.
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
          record({ level, source: "console", text: formatConsoleArgs(args) });
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
    const where =
      event.filename !== ""
        ? ` (${event.filename}:${event.lineno}:${event.colno})`
        : "";
    record({
      level: "error",
      source: "exception",
      text:
        event.error !== undefined && event.error !== null
          ? describeValue(event.error)
          : `${event.message}${where}`,
    });
  };
  // Capture: an element's `error` does not bubble, and the window sees it
  // only on the way down.
  win.addEventListener("error", onError, true);

  const onRejection = (event: Event) => {
    const reason: unknown = Reflect.get(event, "reason");
    record({
      level: "error",
      source: "rejection",
      text: `Unhandled rejection: ${describeValue(reason)}`,
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
          answer.then(
            (response) => {
              if (response.status >= 400) {
                record({
                  level: "error",
                  source: "request",
                  text: `${method} ${url.href} answered ${response.status}${
                    response.statusText ? ` ${response.statusText}` : ""
                  }`,
                  url: url.href,
                  status: response.status,
                });
              }
            },
            (error: unknown) => {
              // An abort is the page changing its mind, not a failure.
              if (isAbort(error)) return;
              record({
                level: "error",
                source: "request",
                text: `${method} ${url.href} failed: ${describeValue(error)}`,
                url: url.href,
              });
            },
          );
          return answer;
        };
  if (wrappedFetch !== null) win.fetch = wrappedFetch;

  // --- what happened before we were listening ------------------------------
  backfill(win, ignoreUrl, record);

  const onPopState = () => noteLocation();
  win.addEventListener("popstate", onPopState);

  const log: PageLog = {
    read: (readOptions = {}) => {
      noteLocation();
      const sinceNavigation = readOptions.sinceNavigation !== false;
      const levels = readOptions.levels;
      const entries = entriesOf(items, sinceNavigation).filter(
        (entry) =>
          levels === undefined ||
          levels.length === 0 ||
          levels.includes(entry.level),
      );
      return {
        path: currentPath(win),
        entries: entries.map((entry) => ({ ...entry })),
        sinceNavigation,
        dropped,
        startedAt,
      };
    },
    counts: () => {
      noteLocation();
      return countEntries(entriesOf(items, true));
    },
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
export function installPageLogInCanvasFrame(): PageLog | null {
  if (typeof window === "undefined") return null;
  try {
    return isValCanvasFrame(window.location.search, parentPathname(window))
      ? installPageLog(window)
      : null;
  } catch {
    return null;
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
  record: (
    entry: Omit<PageLogEntry, "path" | "at" | "text"> & { text: string },
  ) => void,
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

/** The page's path and query: what a client-side navigation moves. */
function currentPath(win: Window): string {
  try {
    return `${win.location.pathname}${win.location.search}`;
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
 * along with its argument.
 */
export function formatConsoleArgs(args: readonly unknown[]): string {
  const [first, ...others] = args;
  let rest: unknown[] = [...args];
  let head = "";
  if (typeof first === "string" && /%[sdifoOjc]/.test(first)) {
    rest = others;
    head = first.replace(/%([sdifoOjc%])/g, (match, kind: string) => {
      if (kind === "%") return "%";
      if (rest.length === 0) return match;
      const value = rest.shift();
      if (kind === "c") return "";
      if (kind === "d" || kind === "i")
        return String(Math.trunc(Number(value)));
      if (kind === "f") return String(Number(value));
      return describeValue(value);
    });
  }
  const tail = rest.map(describeValue);
  return shorten([head, ...tail].filter((part) => part !== "").join(" "));
}

/** One value as text: an error with the top of its stack, an object as JSON. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (isErrorLike(value)) {
    const { name, message, stack } = value;
    const head = `${name || "Error"}: ${message}`;
    if (typeof stack !== "string") return head;
    // The first lines of the stack say where; the rest is the framework.
    const frames = stack
      .split("\n")
      .filter((line) => /^\s*at\s|@/.test(line))
      .slice(0, 4)
      .map((line) => line.trim());
    return frames.length > 0 ? `${head}\n${frames.join("\n")}` : head;
  }
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `[function ${value.name || ""}]`;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

function isErrorLike(
  value: unknown,
): value is { name: string; message: string; stack?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "message") === "string" &&
    typeof Reflect.get(value, "name") === "string"
  );
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
