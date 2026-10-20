import { isDebugEnabled, log, VAL_DEBUG_STORAGE_KEY } from "./log";

const levels = ["error", "warn", "info", "debug"] as const;

function spyAll() {
  return {
    error: jest.spyOn(console, "error").mockImplementation(() => {}),
    warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
    info: jest.spyOn(console, "info").mockImplementation(() => {}),
    debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
  };
}

/** A browser, as far as `log.ts` can tell: a `window` and a `localStorage`. */
function withBrowserStorage(value: string | null, run: () => void) {
  const store = new Map<string, string>();
  if (value !== null) store.set(VAL_DEBUG_STORAGE_KEY, value);
  const before = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
  };
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => store.get(key) ?? null },
    configurable: true,
  });
  try {
    run();
  } finally {
    for (const [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

describe("log", () => {
  const env = process.env.VAL_DEBUG;
  let spies: ReturnType<typeof spyAll>;
  beforeEach(() => {
    delete process.env.VAL_DEBUG;
    spies = spyAll();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (env === undefined) delete process.env.VAL_DEBUG;
    else process.env.VAL_DEBUG = env;
  });

  test("error and warn always print", () => {
    log.error("broke");
    log.warn("fix this");
    expect(spies.error).toHaveBeenCalledWith("[val] broke");
    expect(spies.warn).toHaveBeenCalledWith("[val] fix this");
  });

  test("debug and info are silent unless asked for", () => {
    log.debug("noise");
    log.info("noise");
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });

  test("VAL_DEBUG turns debug and info on", () => {
    process.env.VAL_DEBUG = "1";
    log.debug("detail", { a: 1 });
    log.info("detail");
    expect(spies.debug).toHaveBeenCalledWith("[val] detail", { a: 1 });
    expect(spies.info).toHaveBeenCalledWith("[val] detail");
  });

  test.each(["", "0", "false"])("VAL_DEBUG=%p is off", (value) => {
    process.env.VAL_DEBUG = value;
    expect(isDebugEnabled()).toBe(false);
  });

  test("the localStorage key turns debug on in a browser", () => {
    withBrowserStorage("1", () => {
      log.debug("detail");
    });
    expect(spies.debug).toHaveBeenCalledWith("[val] detail");
  });

  test("a browser without the key stays quiet", () => {
    withBrowserStorage(null, () => {
      log.debug("detail");
    });
    expect(spies.debug).not.toHaveBeenCalled();
  });

  test("storage that throws is treated as off, not as an error", () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      configurable: true,
    });
    const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
      configurable: true,
    });
    try {
      expect(isDebugEnabled()).toBe(false);
    } finally {
      if (storage) Object.defineProperty(globalThis, "localStorage", storage);
      else Reflect.deleteProperty(globalThis, "localStorage");
      if (before) Object.defineProperty(globalThis, "window", before);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("a message that already names Val is not prefixed twice", () => {
    log.warn("[val] link check refused");
    log.warn("[Val] Invalid include pattern");
    expect(spies.warn.mock.calls).toEqual([
      ["[val] link check refused"],
      ["[Val] Invalid include pattern"],
    ]);
  });

  test("a non-string first argument is kept as it is, after the prefix", () => {
    const error = new Error("boom");
    log.error(error);
    expect(spies.error).toHaveBeenCalledWith("[val]", error);
  });

  test("a spy installed after import still sees the call", () => {
    jest.restoreAllMocks();
    for (const level of levels) {
      const late = jest.spyOn(console, level).mockImplementation(() => {});
      process.env.VAL_DEBUG = "1";
      log[level]("late");
      expect(late).toHaveBeenCalledWith("[val] late");
    }
  });
});
