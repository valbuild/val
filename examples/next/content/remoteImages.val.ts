import { s, c } from "../val.config";

/**
 * An images gallery whose files live on Val's remote host rather than in the repo.
 *
 * Here so the `http`-mode e2e suite has something to upload remotely, and it is a
 * gallery rather than an `s.image().remote()` field on purpose: a single remote
 * image or file schema anywhere in the project makes `hasRemoteFileSchema` true,
 * and `/save` then demands remote credentials for EVERY publish — including
 * publishes of plain text in `fs` mode, where a local checkout has no personal
 * access token. A remote *gallery* does not trip that check, so this module can
 * ship in the example app without making `pnpm dev` unable to publish.
 *
 * Starts empty: the entries are whatever a test or a developer uploads.
 */
export default c.define(
  "/content/remoteImages.val.ts",
  s.images({ remote: true, directory: "/public/remote-images" }),
  {},
);
