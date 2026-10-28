import { s, c } from "../val.config";

/**
 * Single media FIELDS whose files live on Val's remote host: an image, a file
 * and a video -- and a rich text whose inline images are remote.
 *
 * The counterpart of `remoteImages.val.ts`, which is a gallery. A field builds
 * its own patch (`createFilePatch`, and the video field's poster beside it)
 * rather than the gallery's `add`, so it is a separate upload path -- and the
 * one every project in the Val app takes, where `files: { remote: true }`
 * makes every `s.image()`, `s.file()` and `s.video()` remote.
 *
 * Every field starts null: the values are whatever a test or a developer
 * uploads. Registered only when `VAL_E2E_REMOTE_MEDIA` is
 * `"true"`, for the reason `val.modules.ts` gives.
 */
export default c.define(
  "/content/remoteFields.val.ts",
  s.object({
    image: s.image().remote().nullable(),
    file: s.file().remote().nullable(),
    video: s.video().remote().nullable(),
    // Rich text whose inline images are remote: where the assistant puts an
    // image it was given into running text.
    body: s.richtext({ img: s.image().remote() }),
  }),
  { image: null, file: null, video: null, body: [] },
);
