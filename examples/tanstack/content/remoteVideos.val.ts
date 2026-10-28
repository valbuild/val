import { s, c } from "../val.config";

/**
 * A video set whose files live on Val's remote host: the shape a project made
 * from a template has its videos in, under `files: { remote: true }`.
 *
 * Here so the `http`-mode e2e suite can upload a set entry's video and poster
 * from the Validate page (`e2e/http/validateUpload.spec.ts`). Starts empty:
 * the entries are whatever a test or a developer adds.
 *
 * Registered only when `VAL_E2E_REMOTE_MEDIA` is `"true"`, for
 * the reason `val.modules.ts` gives.
 */
export default c.define(
  "/content/remoteVideos.val.ts",
  s.videodir("/public/remote-videos").remote(),
  {},
);
