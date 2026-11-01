import type { SelectorSource, ValModule, ValModules } from "@valbuild/core";

/**
 * The modules of a `val.modules` registry, ready for `HostStore.receive`.
 *
 * The defs are async thunks (`() => import("./x.val")`), so intake has to
 * await them. One failed module must not lose the rest, so each is settled
 * separately -- and `HostStore.receive` records the ones that fail to
 * serialize rather than throwing, for the same reason.
 *
 * Its own function so the scenario harness (`scenarios/`) takes modules in
 * exactly as the Studio does.
 */
export async function loadValModules(
  valModules: ValModules,
): Promise<ValModule<SelectorSource>[]> {
  const settled = await Promise.allSettled(
    valModules.modules.map((entry) => entry.def()),
  );
  const modules: ValModule<SelectorSource>[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      modules.push(result.value.default);
    }
  }
  return modules;
}
