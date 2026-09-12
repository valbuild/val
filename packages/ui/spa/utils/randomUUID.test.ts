import { randomUUID } from "./randomUUID";

/** Version 4, variant 10: what `crypto.randomUUID` would have produced. */
const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  /**
   * `crypto` is a getter on the global in both jsdom and node, so it is
   * replaced through the property descriptor rather than assigned.
   */
  function setCrypto(value: unknown) {
    Object.defineProperty(globalThis, "crypto", {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, "crypto", original);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  });

  test("uses crypto.randomUUID where there is one", () => {
    const randomUUIDImpl = jest.fn(
      () => "11111111-2222-4333-8444-555555555555",
    );
    setCrypto({ randomUUID: randomUUIDImpl });

    expect(randomUUID()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUIDImpl).toHaveBeenCalledTimes(1);
  });

  test("an insecure context has no randomUUID, and still gets a v4", () => {
    // Exactly what a browser exposes over plain http on a LAN address: a
    // `crypto` object carrying `getRandomValues` and nothing else. This is the
    // case that crashed the Studio on first render.
    const getRandomValues = jest.fn((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = 0xff;
      }
      return bytes;
    });
    setCrypto({ getRandomValues });

    const uuid = randomUUID();
    expect(uuid).toMatch(V4);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    // All-ones bytes, so only the version and variant nibbles differ - which is
    // what proves they are written at all.
    expect(uuid).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  test("no crypto at all still gets a v4", () => {
    setCrypto(undefined);

    expect(randomUUID()).toMatch(V4);
  });

  test("does not repeat itself without crypto.randomUUID", () => {
    setCrypto(original?.get?.() ?? original?.value);
    const withoutRandomUUID: unknown = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    };
    setCrypto(withoutRandomUUID);

    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(randomUUID());
    }
    expect(seen.size).toBe(1000);
  });
});
