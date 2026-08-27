import { s, c } from "../val.config";

/**
 * An images gallery whose files live on Val's remote host rather than in the repo.
 *
 * Here so the `http`-mode e2e suite has something to upload remotely.
 *
 * A gallery rather than an `s.image().remote()` field only because that is the
 * shape the tests drive; either would do. Both make `hasRemoteFileSchema` true
 * for the whole project, which is why this module is registered only on request —
 * see `val.modules.ts`.
 *
 * Starts empty: the entries are whatever a test or a developer uploads.
 *
 * Registered only when `NEXT_PUBLIC_VAL_EXAMPLE_REMOTE_MEDIA` is `"true"` — see
 * `val.modules.ts` for why it is opt-in.
 */
export default c.define(
  "/content/remoteImages.val.ts",
  s.images({ remote: true, directory: "/public/remote-images" }),
  {},
);
