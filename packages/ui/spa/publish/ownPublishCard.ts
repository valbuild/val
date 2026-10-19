import type { HandoffState } from "../components/shell/PublishHandoff";
import type { PublishJobsState } from "./publishJobs";

/**
 * What the overlay's card says about a publish this page made by itself.
 *
 * A page that cannot build hands a publish to a builder tab, whose card
 * (`useSiteHandoff`) follows it. One of content alone needs no build, so the
 * page presses it itself and opens no tab -- and without this it said
 * nothing at all: the overlay has no status bar and no toasts.
 *
 * The newest press only, and only this page's own: one a builder tab pressed
 * (`viaTab`) has the tab's card. `null` for nothing to say, or for a press
 * the editor dismissed.
 */
export function ownPublishCard(
  state: PublishJobsState,
  dismissed: ReadonlySet<string>,
): { requestId: string; card: HandoffState } | null {
  const request = state.requests.at(-1);
  if (
    request === undefined ||
    request.viaTab ||
    dismissed.has(request.requestId)
  ) {
    return null;
  }
  const { requestId, status } = request;
  switch (status.kind) {
    case "queued":
    case "publishing":
      return {
        requestId,
        card: request.needsBuilder
          ? { kind: "needs-builder" }
          : { kind: "publishing" },
      };
    case "live":
      return {
        requestId,
        card: {
          kind: "live",
          ms: (request.settledAt ?? request.pressedAt) - request.pressedAt,
          followed: true,
        },
      };
    case "failed":
      return {
        requestId,
        card: { kind: "failed", message: status.message, followed: true },
      };
    case "cancelled":
    case "nothing-to-publish":
      return null;
  }
}
