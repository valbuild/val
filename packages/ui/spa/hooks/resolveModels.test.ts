import { resolveModels } from "./useAIWebSocket";
import { writePreferredModel } from "./aiModelPreference";

/** The two methods `aiModelPreference` uses; jest runs this file in node. */
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

const listed = [
  { provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5" },
  {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
  },
  { provider: "openai", model: "gpt-6.1-sol", label: "gpt-6.1-sol" },
];

describe("resolveModels", () => {
  test("starts on the model the content server chose", () => {
    const res = resolveModels({
      providers: ["anthropic", "openai"],
      models: listed,
      defaultModel: { provider: "openai", model: "gpt-6.1-sol" },
    });
    expect(res.defaultModel).toEqual({
      provider: "openai",
      model: "gpt-6.1-sol",
    });
    expect(res.selected).toEqual(res.defaultModel);
  });

  test("an editor's remembered pick still wins over the server's default", () => {
    writePreferredModel({ provider: "anthropic", model: "claude-opus-5-5" });
    const res = resolveModels({
      providers: ["anthropic"],
      models: listed,
      defaultModel: { provider: "anthropic", model: "claude-sonnet-5-5" },
    });
    expect(res.defaultModel).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(res.selected).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
  });

  test("ignores a server default that is not on offer", () => {
    const res = resolveModels({
      providers: ["anthropic"],
      models: listed.slice(0, 2),
      defaultModel: { provider: "openai", model: "gpt-6.1-sol" },
    });
    expect(res.defaultModel).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });

  test("an older content server, with no default, gets the catalog's pick", () => {
    expect(
      resolveModels({ providers: ["anthropic"], models: [] }).defaultModel,
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(resolveModels({}).defaultModel).toEqual({
      provider: "openai",
      model: "gpt-5.1",
    });
  });

  test("no reachable provider means no model", () => {
    expect(resolveModels({ providers: [], models: [] })).toEqual({
      defaultModel: null,
      offered: [],
      selected: null,
    });
  });
});
