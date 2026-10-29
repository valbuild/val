/**
 * What Val Build said it does not make for this project yet: asked once per
 * kind, and every build -- or quick preview -- after that is made in the tab
 * without asking again. A reload asks again, which is how a project it is
 * turned on for finds out. Kept per kind: content that has the build route
 * and not the quick preview one says "off" to one and not the other.
 */
export type ServerKind = "build" | "quick-preview";
const off = new Set<ServerKind>();

/** What Val Build answers for a project it does not build yet. */
export type ServerOff = { status: "off" };

function isOff<T>(outcome: T | ServerOff): outcome is ServerOff {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "status" in outcome &&
    outcome.status === "off"
  );
}

/**
 * Val Build first (valbuild/home `docs/plans/server-builds.md`): no bundler
 * here, no builder tab, and the same on an iPhone. A project it does not
 * build yet (`off`) is built `here`, as before, and so is every one of the
 * same `kind` after it in this page.
 */
export async function serverFirst<T>(
  onServer: () => Promise<T | ServerOff>,
  here: () => Promise<T>,
  kind: ServerKind = "build",
): Promise<T> {
  if (!off.has(kind)) {
    const outcome = await onServer();
    if (!isOff(outcome)) return outcome;
    off.add(kind);
  }
  return here();
}

/** Whether Val Build said it does not make `kind` here: it is not asked again until a reload. */
export function serverKnownOff(kind: ServerKind): boolean {
  return off.has(kind);
}

/** Val Build said "off" to `kind` outside `serverFirst`. */
export function markServerOff(kind: ServerKind): void {
  off.add(kind);
}

/** For tests: forget what Val Build said. */
export function resetServerBuildsForTests(): void {
  off.clear();
}
