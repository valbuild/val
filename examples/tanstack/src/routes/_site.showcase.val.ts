import { s, c, tanstackRouter } from "../../val.config";

/*
 * The content of `src/routes/_site.showcase.tsx`: the page that renders every
 * other module in this app.
 *
 * Its own content is deliberately thin — a heading and a note per section — so
 * that what the page shows is the OTHER modules. `s.record(s.string(), ...)`
 * keys the notes by section name, which is the shape to reach for when the set
 * of keys is the app's rather than an editor's.
 */
export default c.define(
  "/src/routes/_site.showcase.val.ts",
  s.router(
    tanstackRouter,
    s
      .object({
        title: s.string(),
        intro: s.string().multiline(),
        notes: s
          .record(
            s.string().describe("The section this note belongs to"),
            s.string().multiline(),
          )
          .describe("One note per section of the page"),
      })
      .preview(({ val }) => ({ title: val.title, subtitle: val.intro })),
  ),
  {
    "/showcase": {
      title: "Every schema Val has",
      intro:
        "Each section below is one content module. Open the Studio at /val and edit any of them — this page follows as you type.",
      notes: {
        theme:
          "s.color() in four notations, one with an alpha channel and one nullable.",
        gallery:
          "s.imageset(): a collection that owns the metadata, so a field pointing at it stores only a path.",
        downloads:
          "s.fileset(): the same collection for files that are not images.",
        media:
          "Single s.image() and s.file() fields, both plain and gallery-backed.",
        links:
          "externalPageRouter: pages that are not in this app, keyed by their whole URL.",
        kb: "A .jsonValues() record: each entry is its own file, loaded on demand.",
        translated:
          "s.locale(), both ways: a locale-keyed record and a locale field.",
        access: "readonly() and hidden(), which only the Studio enforces.",
      },
    },
  },
);
