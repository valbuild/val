import { c, nextAppRouter, s } from "../../../val.config";

/**
 * A PLAIN router read from a server component.
 *
 * The combination nothing else covered. `/blogs/[blog]` is a plain router read
 * by a client component (`useValRoute`), `/support/[slug]` is a
 * `.jsonValues()` router read by a server component (`fetchValRoute`) — and
 * `fetchValRoute` takes a completely different path for the two: a
 * `.jsonValues()` record loads one entry through the draft-aware
 * `loadDraftJsonEntry`, while a plain router resolves the whole module through
 * `fetchVal`. Only the second was untested, and it is the one that decides
 * whether a page that exists only in an uncommitted patch renders on the
 * server.
 */
export default c.define(
  "/app/notes/[note]/page.val.ts",
  s.router(
    nextAppRouter,
    s.string().describe("The URL of the note"),
    s
      .object({
        title: s.string(),
        body: s.string(),
      })
      .preview(({ val }) => ({ title: val.title, subtitle: val.body })),
  ),
  {
    "/notes/first": {
      title: "First note",
      body: "A note that is committed, so it renders without any patches.",
    },
  },
);
