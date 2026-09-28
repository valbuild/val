/**
 * How long a deploy may report itself as in progress before the Studio stops
 * believing it.
 *
 * The build state is relayed from somewhere else entirely (GitHub deployment
 * events, via the content service), and when that channel goes quiet a publish
 * sits at `created` or `pending` for good. A build that has been "building" for
 * an hour is not building; it is a state nobody has reported. Saying so is the
 * honest answer — a spinner there is a promise that something is about to
 * happen, and nothing is.
 */
export const DEPLOYMENT_STATUS_UNKNOWN_AFTER_MS = 60 * 60 * 1000;

/**
 * Whether a deploy the host last called `created` or `pending` has been in that
 * state too long to still be shown as in progress.
 *
 * An unreadable timestamp is not evidence of age, so it is not stale.
 */
export function isDeploymentStatusStale(
  state: string,
  updatedAt: string,
  now: number,
): boolean {
  if (state !== "created" && state !== "pending") return false;
  const at = new Date(updatedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at > DEPLOYMENT_STATUS_UNKNOWN_AFTER_MS;
}

/**
 * When the next of these deploys goes stale, in ms from `now`, or `null` if
 * none of them will.
 *
 * Staleness is a function of the clock, not of the feed: a deploy crosses the
 * line while nothing about it changes. So whatever renders it has to be woken
 * at that moment, and only then — a timer per minute would re-render the shell
 * sixty times to change one word once.
 */
export function msUntilNextStale(
  deployments: readonly { state: string; updatedAt: string }[],
  now: number,
): number | null {
  let next: number | null = null;
  for (const { state, updatedAt } of deployments) {
    if (state !== "created" && state !== "pending") continue;
    const at = new Date(updatedAt).getTime();
    if (Number.isNaN(at)) continue;
    const remaining = at + DEPLOYMENT_STATUS_UNKNOWN_AFTER_MS - now;
    if (remaining < 0) continue;
    if (next === null || remaining < next) next = remaining;
  }
  return next;
}
