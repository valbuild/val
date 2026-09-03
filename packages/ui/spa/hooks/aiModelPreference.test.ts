import {
  resolvePreferredModel,
  writePreferredModel,
} from "./aiModelPreference";
import type { AIModel } from "./useAIWebSocket";

const opus: AIModel = { provider: "anthropic", model: "claude-opus-5" };
const haiku: AIModel = { provider: "anthropic", model: "claude-haiku-4-5" };
const gpt: AIModel = { provider: "openai", model: "gpt-5.1" };

/**
 * A stand-in for the two methods this module uses. The repo's jest runs in
 * node, and pulling in jsdom for one file would be a heavy dependency to prove
 * a `JSON.parse`.
 */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
  return store;
}

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("resolvePreferredModel", () => {
  test("uses the remembered model when it is still offered", () => {
    writePreferredModel(haiku);
    expect(resolvePreferredModel([opus, haiku, gpt], opus)).toEqual(haiku);
  });

  /**
   * The case this exists for: an account can lose access to a model, or a key
   * can be swapped for one on a different tier. Sending a model the provider
   * will refuse is worse than quietly moving to one it accepts.
   */
  test("drops a remembered model the provider no longer offers", () => {
    writePreferredModel({ provider: "anthropic", model: "retired-model" });
    expect(resolvePreferredModel([opus, gpt], gpt)).toEqual(gpt);
  });

  test("falls back to the server's default when nothing is remembered", () => {
    expect(resolvePreferredModel([opus, gpt], gpt)).toEqual(gpt);
  });

  test("takes the first offered model when the default is not on the list", () => {
    expect(
      resolvePreferredModel([opus, haiku], { provider: "openai", model: "x" }),
    ).toEqual(opus);
  });

  test("with nothing offered it passes the fallback through, including null", () => {
    expect(resolvePreferredModel([], gpt)).toEqual(gpt);
    expect(resolvePreferredModel([], null)).toBe(null);
  });

  /**
   * Storage was written by some earlier version of this code and is untrusted
   * like anything else read back from the world. A provider this build cannot
   * drive must not be handed on as an `AIModel`.
   */
  test("a stored provider this build does not know is rejected", () => {
    store.set(
      "val:ai:model",
      JSON.stringify({ provider: "some-future-provider", model: "x" }),
    );
    expect(resolvePreferredModel([opus, gpt], gpt)).toEqual(gpt);
  });

  test("extra fields in storage are not carried through", () => {
    store.set(
      "val:ai:model",
      JSON.stringify({ ...haiku, injected: "should not survive" }),
    );
    expect(resolvePreferredModel([opus, haiku], opus)).toEqual({
      provider: haiku.provider,
      model: haiku.model,
    });
  });

  test("a corrupt stored value is ignored rather than thrown", () => {
    store.set("val:ai:model", "{not json");
    expect(resolvePreferredModel([opus], opus)).toEqual(opus);
    store.set("val:ai:model", JSON.stringify({ provider: 1 }));
    expect(resolvePreferredModel([opus], opus)).toEqual(opus);
  });
});

describe("when storage is unavailable at all", () => {
  /**
   * A private window, a browser set to block site data, or any non-browser
   * context: reading must not take the assistant down over a preference.
   */
  test("reads and writes are inert rather than throwing", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(() => writePreferredModel(opus)).not.toThrow();
    expect(resolvePreferredModel([opus, gpt], gpt)).toEqual(gpt);
  });
});
