import { c, s } from "../val.config";

/**
 * A `.jsonValues()` record whose entry content contains an `s.image()`.
 *
 * The point of the fixture: the image — and therefore everything a metadata fix
 * has to edit — is in `jsonEntryMedia/hero.val.json`, not in this file. This
 * file only says which file to read. Editor tooling that assumes the value is
 * here has nothing to work with.
 *
 * What is on disk is CORRECT, so the example app gains no new validation error;
 * the language-server tests supply a wrong-metadata version as an unsaved
 * buffer.
 */
export default c.define(
  "/content/jsonEntryMedia.val.ts",
  s.record(s.object({ image: s.image() })).jsonValues(),
  {
    hero: c.json(() => import("./jsonEntryMedia/hero.val.json")),
  },
);
