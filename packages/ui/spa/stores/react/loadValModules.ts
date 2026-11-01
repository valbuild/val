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
