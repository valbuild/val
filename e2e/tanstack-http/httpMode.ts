import { httpTarget } from "../http/httpMode";
import {
  TANSTACK_HTTP_APP_PORT,
  TANSTACK_HTTP_PROJECT,
  TANSTACK_MOCK_CONTENT_PORT,
  TANSTACK_ROOT,
} from "./config";

/**
 * The proxy-mode helpers, bound to `examples/tanstack` and its own mock.
 *
 * The same helpers `e2e/http/` uses; only which app, which mock and which
 * project differ. What drives the store from inside the page does not depend
 * on the app at all, so it is re-exported as it is.
 */
export const { mock, openHttpStudio, sessionCookie, contextAs } = httpTarget({
  appPort: TANSTACK_HTTP_APP_PORT,
  mockPort: TANSTACK_MOCK_CONTENT_PORT,
  project: TANSTACK_HTTP_PROJECT,
  root: TANSTACK_ROOT,
});

export { createUnsavedPatch, writePatch } from "../http/httpMode";
