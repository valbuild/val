import type { RequestPublish } from "../stores/PublishSeam";
import { randomUUID } from "../utils/randomUUID";
import type { StudioJobClient } from "./jobClient";
import { isTransientPublishError } from "./publishClient";
import { PUBLISH_TAB_ID } from "./tabId";
import { withinDeadline } from "./withinDeadline";

/**
 * The `requestPublish` seam over the job routes: a press of Publish is a new
 * request, pressed by this tab. Every press mints its own id -- the id is
 * what makes a retried press the same press -- and never throws: a refusal is
 * a result, as every seam's is.
 *
 * A builder tab pressing for the page that opened it passes that page's id and
 * tab instead (`pressAs`), so the page can follow the request it named.
 */
export function createRequestPublish(
  client: StudioJobClient,
  tab: string = PUBLISH_TAB_ID,
): RequestPublish {
  return async (pressAs) => {
    const requestId = pressAs?.requestId ?? randomUUID();
    try {
      const press = client.press(requestId, pressAs?.tab ?? tab);
      /*
       * A builder tab's press is bounded: it is asked again under the same
       * id, so one that never answered is not lost. This page's own is not
       * -- its retry is a new press, with a new id.
       */
      const pressed = await (pressAs === undefined
        ? press
        : withinDeadline(press));
      return { status: "requested", requestId, ...pressed };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        transient: isTransientPublishError(error),
      };
    }
  };
}
