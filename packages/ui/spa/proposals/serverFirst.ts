/**
 * Whether Val Build said it does not build this project yet: asked once,
 * and every build and quick preview after that is made in the tab without
 * asking again. A reload asks again, which is how a project it is turned on
 * for finds out.
 */
let serverBuildsOff = false;

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
 * build yet (`off`) is built `here`, as before, and so is every build and
 * quick preview after it in this page.
 */
export async function serverFirst<T>(
  onServer: () => Promise<T | ServerOff>,
  here: () => Promise<T>,
): Promise<T> {
  if (!serverBuildsOff) {
    const outcome = await onServer();
    if (!isOff(outcome)) return outcome;
    serverBuildsOff = true;
  }
  return here();
}

/** Whether Val Build said it does not build this project: nothing is asked of it again until a reload. */
export function serverBuildsKnownOff(): boolean {
  return serverBuildsOff;
}

/** For tests: forget what Val Build said. */
export function resetServerBuildsForTests(): void {
  serverBuildsOff = false;
}
