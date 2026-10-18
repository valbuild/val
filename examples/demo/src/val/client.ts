import { initValClient } from "@valbuild/tanstack/client";
import { config } from "../../val.config";

/**
 * Val's hooks. The demo reads ALL its content through these: in the Studio's
 * canvas they resolve what the editor holds, which is the only place the
 * demo's edits exist -- a loader on the server never sees them.
 */
const { useValStega: useVal, useValRouteStega: useValRoute } =
  initValClient(config);

export { useVal, useValRoute };
