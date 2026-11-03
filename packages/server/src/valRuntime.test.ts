import { initVal, type ValModules } from "@valbuild/core";
import { InMemoryPatchStore } from "./ValOpsMemory";
import { RUNTIMES_PER_MODULES, valRuntime } from "./valRuntime";
import type { ValServerConfig } from "./ValServer";

const { s, c, config } = initVal();
const valModules: ValModules = {
  config,
  modules: [
    {
      def: async () => ({
        default: c.define("/content/home.val.ts", s.string(), "Hello"),
      }),
    },
  ],
};
const memory = (patchStore: InMemoryPatchStore): ValServerConfig => ({
  mode: "memory",
  route: "/api/val",
  sourceFiles: {},
  patchStore,
  unsafelyAllowUnauthenticated: true,
  valContentUrl: "http://localhost:4000",
  config,
});

describe("valRuntime", () => {
  test("callers with the same options share one runtime", () => {
    const store = new InMemoryPatchStore();
    expect(valRuntime(valModules, memory(store))).toBe(
      valRuntime(valModules, memory(store)),
    );
  });

  test("a host that makes a store per call does not make the process keep every runtime", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const first = new InMemoryPatchStore();
      const firstRuntime = valRuntime(valModules, memory(first));
      for (let i = 0; i < RUNTIMES_PER_MODULES; i++) {
        valRuntime(valModules, memory(new InMemoryPatchStore()));
      }
      // Let go: asked again, it is made again.
      expect(valRuntime(valModules, memory(first))).not.toBe(firstRuntime);
    } finally {
      warn.mockRestore();
    }
  });
});
