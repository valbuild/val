import type { RequestPublish } from "../stores/PublishSeam";
import { randomUUID } from "../utils/randomUUID";
import type { StudioJobClient } from "./jobClient";
import { PUBLISH_TAB_ID } from "./tabId";

/**
 * The `requestPublish` seam over the job routes: a press of Publish is a new
 * request, pressed by this tab. Every press mints its own id -- the id is
 * what makes a retried press the same press -- and never throws: a refusal is
 * a result, as every seam's is.
 */
export function createRequestPublish(
  client: StudioJobClient,
  tab: string = PUBLISH_TAB_ID,
): RequestPublish {
  return async () => {
    const requestId = randomUUID();
    try {
      const pressed = await client.press(requestId, tab);
      return { status: "requested", requestId, ...pressed };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
