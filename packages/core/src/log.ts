/**
 * Val's console output, and the one place that decides what reaches it.
 *
 * Val runs inside someone else's app: the server in their dev server and their
 * production logs, the Studio in their browser tab. Everything Val prints lands
 * in a console that belongs to a developer who did not write the code printing
 * it, so the levels are split by who the line is FOR:
 *
 * - `error` and `warn` are for that developer -- something broke, or something
 *   they can fix -- and always print.
 * - `info` and `debug` are for whoever is debugging Val, and print only when
 *   asked for: `VAL_DEBUG=1` in the environment of a server, or
 *   `localStorage.setItem("val:debug", "1")` in a browser. Both are read on
 *   every call, so turning it on in a live tab needs no reload.
 *
 * In Node `console.debug` IS `console.log`, so a bare `console.debug` is not
 * quiet on a server: it went to the developer's terminal on every request.
 * That is why `no-console` is on for the packages that run in a host app, and
 * this file is the exemption.
 *
 * Every line gets a `[val]` prefix, so a developer can filter Val out (or in).
 * Arguments are otherwise passed through as they are, so an `Error` still
 * prints with its stack.
 */

const PREFIX = "[val]";

/** The localStorage key that turns `debug` and `info` on in a browser. */
export const VAL_DEBUG_STORAGE_KEY = "val:debug";

function isOn(value: string | null | undefined): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    value !== "0" &&
    value !== "false"
  );
}

function fromEnv(): string | undefined {
  // `typeof` first: a browser bundle may have no `process` at all.
  if (typeof process === "undefined") {
    return undefined;
  }
  return process.env?.VAL_DEBUG;
}

function fromLocalStorage(): string | null | undefined {
  // Not in Node, even where it has a `localStorage`: from Node 25 merely
  // touching it without `--localstorage-file` prints a warning of its own.
  if (!("window" in globalThis)) {
    return undefined;
  }
  try {
    const storage: unknown = Reflect.get(globalThis, "localStorage");
    if (
      typeof storage === "object" &&
      storage !== null &&
      "getItem" in storage &&
      typeof storage.getItem === "function"
    ) {
      const value: unknown = storage.getItem(VAL_DEBUG_STORAGE_KEY);
      return typeof value === "string" ? value : null;
    }
  } catch {
    // A sandboxed frame or blocked site data throws on access.
  }
  return undefined;
}

export function isDebugEnabled(): boolean {
  return isOn(fromEnv()) || isOn(fromLocalStorage());
}

function withPrefix(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first === "string") {
    if (/^\[val\]/i.test(first)) {
      return args;
    }
    return [`${PREFIX} ${first}`, ...rest];
  }
  return [PREFIX, ...args];
}

/*
 * `console` is looked up on every call rather than captured, so a test that
 * spies on `console.warn` after this module loaded still sees the call.
 */
export const log = {
  error(...args: unknown[]): void {
    console.error(...withPrefix(args));
  },
  warn(...args: unknown[]): void {
    console.warn(...withPrefix(args));
  },
  info(...args: unknown[]): void {
    if (isDebugEnabled()) {
      console.info(...withPrefix(args));
    }
  },
  debug(...args: unknown[]): void {
    if (isDebugEnabled()) {
      console.debug(...withPrefix(args));
    }
  },
};
