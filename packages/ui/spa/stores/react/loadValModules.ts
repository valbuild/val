import type { ValModules } from "@valbuild/core";
import type { IntakeModule } from "../HostStore";

/**
 * The modules of a `val.modules` registry, ready for `HostStore.receive`.
 *
 * The defs are async thunks (`() => import("./x.val")`), so intake has to
 * await them. One failed module must not lose the rest, so each is settled
 * separately -- and `HostStore.receive` records the ones that fail to
 * serialize rather than throwing, for the same reason.
 *
 * A def that rejects -- a module whose code throws, mid-edit -- stays in the
 * list, at its place, as what it threw. Its place is the only thing that
 * names it (an entry is a `def` and nothing else), and `HostStore.receive`
 * uses it to say which module failed and to keep the one it had there. It
 * used to be left out, and the Studio said nothing.
 *
 * Its own function so the scenario harness (`scenarios/`) takes modules in
 * exactly as the Studio does.
 */
export async function loadValModules(
  valModules: ValModules,
): Promise<IntakeModule[]> {
  const settled = await Promise.allSettled(
    valModules.modules.map((entry) => entry.def()),
  );
  return settled.map(
    (result): IntakeModule =>
      result.status === "fulfilled"
        ? result.value.default
        : {
            threw:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          },
  );
}

/**
 * The Val modules bundle, read in this realm: `val.modules.ts`'s default
 * export, `modules(config, [...])`. The modules it makes come from the
 * site's copy of `@valbuild/core`; the Studio reads them with its own, which
 * works because their symbols are `Symbol.for` (`isValModule`).
 */
export function registryOfEntry(entry: unknown): ValModules {
  const registry =
    typeof entry === "object" && entry !== null && "default" in entry
      ? entry.default
      : undefined;
  if (!isValModules(registry)) {
    throw new Error(
      "val.modules.ts does not export modules(config, [...]) as its default.",
    );
  }
  return registry;
}

function isValModules(value: unknown): value is ValModules {
  return (
    typeof value === "object" &&
    value !== null &&
    "config" in value &&
    "modules" in value &&
    Array.isArray(value.modules) &&
    value.modules.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "def" in entry &&
        typeof entry.def === "function",
    )
  );
}
